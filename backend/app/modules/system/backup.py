"""백업/복원 + 자동 백업 스케줄 endpoints.

- /backup/export : 전체 데이터+storage → ZIP
- /backup/restore : ZIP → 전체 데이터 wipe + 교체 (destructive)
- /backup/schedule/* : 주기적 자동 백업 설정 + 수동 트리거 + 파일 관리

모든 endpoint super_admin + 2FA 필수 (destructive 작업).

router 객체는 router.py에서 공유. router.py 끝의 'from . import backup'으로 등록.
"""

import os
from pathlib import Path

from fastapi import Body, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response as FastResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import verify_2fa_session
from app.core.config import settings
from app.core.database import get_db
from app.core.http import content_disposition
from app.core.permissions import require_super_admin
from app.models.user import User
from app.modules.system.schemas import BackupScheduleUpdate
from app.services.backup import RestoreError, export_all, restore_all

from app.modules.system.router import router


@router.get("/backup/export")
async def export_backup(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """전체 데이터 + storage 백업 → ZIP 다운로드.

    포함:
      - manifest.json (버전, 날짜, alembic revision, 행수)
      - data.json (모든 테이블, SQLAlchemy 메타데이터 기반 — 새 테이블 자동 포함)
      - storage.tar.gz (사용자 업로드 파일)

    DB 엔진 무관 (SQLite ↔ PostgreSQL 호환).
    2FA 필수 (system.backup.manage requires_2fa).
    """
    await verify_2fa_session(user, request, db)
    zip_bytes = await export_all(db)
    await log_action(db, user, "backup.export", f"size:{len(zip_bytes)}", request=request, is_sensitive=True)
    from datetime import datetime, timezone
    filename = f"school_backup_{settings.SCHOOL_SHORT}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    return FastResponse(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition(filename)},
    )


@router.post("/backup/restore/preview")
async def restore_preview(
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """복원 미리보기 — 데이터 건드리지 않고 manifest/호환성만 검증."""
    from app.core.upload import validate_upload, POLICY_BACKUP
    zip_bytes = await validate_upload(file, POLICY_BACKUP)
    try:
        return await restore_all(db, zip_bytes, confirm=False)
    except RestoreError as e:
        raise HTTPException(400, str(e))


@router.post("/backup/restore")
async def restore_apply(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """실제 복원 — 모든 데이터 wipe 후 백업으로 교체. **돌이킬 수 없음**.

    먼저 /backup/restore/preview로 검증 권장.
    복원 후 alembic 버전이 다르면 백엔드 재시작 + `alembic upgrade head` 실행.
    2FA 필수 (destructive 작업).
    """
    await verify_2fa_session(user, request, db)
    from app.core.upload import validate_upload, POLICY_BACKUP
    zip_bytes = await validate_upload(file, POLICY_BACKUP)
    try:
        result = await restore_all(db, zip_bytes, confirm=True)
    except RestoreError as e:
        raise HTTPException(400, str(e))
    await log_action(
        db, user, "backup.restore",
        f"rows:{sum(result.get('row_counts', {}).values())}",
        request=request, is_sensitive=True,
    )
    return result


@router.post("/backup/factory-reset")
async def factory_reset_apply(
    request: Request,
    payload: dict = Body(default={}),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """전체 초기화 — 모든 데이터+계정(super_admin 포함) 삭제 후 기본 시드만 남김.

    복원 후 첫 회원가입자가 다시 super_admin (BOOTSTRAP_MODE=first_signup).
    **돌이킬 수 없음** — super_admin + 2FA + 확인문구('전체 초기화') 필수.
    """
    await verify_2fa_session(user, request, db)
    if (payload or {}).get("confirm") != "전체 초기화":
        raise HTTPException(400, "확인 문구가 일치하지 않습니다. '전체 초기화'를 정확히 입력하세요.")
    from app.services.backup import factory_reset
    result = await factory_reset(db)
    await log_action(
        db, user, "backup.factory_reset",
        f"wiped_tables:{result.get('wiped_tables')} storage:{result.get('storage_cleared')}",
        request=request, is_sensitive=True,
    )
    return result


# ── 자동 백업 스케줄 ──
# 백그라운드 task는 main.py lifespan에서 자동 시작.
# 이 API는 설정 조회·변경 + 수동 트리거 + 저장된 파일 목록.


@router.get("/backup/schedule")
async def get_backup_schedule(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """현재 자동 백업 스케줄 설정 + 최근 실행 상태."""
    from app.core.backup_scheduler import get_config
    return await get_config(db)


@router.put("/backup/schedule")
async def update_backup_schedule(
    body: BackupScheduleUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """자동 백업 설정 변경 (부분 업데이트). 2FA 필수."""
    from app.core.backup_scheduler import set_config
    await verify_2fa_session(user, request, db)
    patch = body.model_dump(exclude_unset=True)
    try:
        result = await set_config(db, patch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await log_action(
        db, user, "backup.schedule.update",
        target=f"updated:{sorted(patch.keys())}", request=request, is_sensitive=True,
    )
    return result


@router.post("/backup/schedule/run-now")
async def trigger_backup_now(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """즉시 한 번 백업 실행 (스케줄과 무관). 2FA 필수."""
    from app.core.backup_scheduler import run_backup_now
    await verify_2fa_session(user, request, db)
    try:
        result = await run_backup_now(db)
    except Exception as e:
        raise HTTPException(500, f"백업 실행 실패: {e}")
    await log_action(
        db, user, "backup.schedule.run_now",
        target=f"file:{result['filename']} size:{result['size_bytes']}",
        request=request, is_sensitive=True,
    )
    return result


@router.get("/backup/schedule/files")
async def list_backup_files(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """저장된 자동 백업 파일 목록."""
    from app.core.backup_scheduler import list_backups
    return {"items": await list_backups(db)}


@router.delete("/backup/schedule/files/{filename}")
async def delete_backup_file(
    filename: str, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """저장된 백업 파일 1개 삭제. 2FA 필수."""
    from app.core.backup_scheduler import get_config, _is_backup_file
    await verify_2fa_session(user, request, db)

    # 경로 traversal 방어
    if not _is_backup_file(filename) or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "유효하지 않은 파일명")

    config = await get_config(db)
    target = Path(config["output_dir"]) / filename
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "파일 없음")

    try:
        os.remove(target)
    except OSError as e:
        raise HTTPException(500, f"삭제 실패: {e}")

    await log_action(
        db, user, "backup.schedule.delete_file",
        target=filename, request=request, is_sensitive=True,
    )
    return {"ok": True}


@router.get("/backup/schedule/files/{filename}/download")
async def download_backup_file(
    filename: str, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """저장된 자동 백업 파일 1개 다운로드. 2FA 필수."""
    from app.core.backup_scheduler import get_config, _is_backup_file
    await verify_2fa_session(user, request, db)

    if not _is_backup_file(filename) or "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "유효하지 않은 파일명")

    config = await get_config(db)
    target = Path(config["output_dir"]) / filename
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "파일 없음")

    await log_action(
        db, user, "backup.schedule.download",
        target=filename, request=request, is_sensitive=True,
    )
    data = target.read_bytes()
    return FastResponse(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": content_disposition(filename)},
    )
