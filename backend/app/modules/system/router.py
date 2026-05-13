"""시스템 라우터 — 헬스체크, 감사로그, 메뉴 설정, 카테고리 관리, 사이트 브랜딩"""

import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission, require_super_admin, require_admin
from app.models.user import User
from app.models.audit import AuditLog
from app.models.setting import Setting

BRANDING_DIR = Path(__file__).resolve().parents[3] / "storage" / "branding"

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "school": settings.SCHOOL_NAME,
        "version": "1.0.0",
    }


@router.get("/audit-logs")
async def get_audit_logs(
    page: int = 1,
    per_page: int = 50,
    action: str | None = None,
    date_from: str | None = None,      # ISO 8601 (예: "2026-05-01")
    date_to: str | None = None,
    sensitive_only: bool = False,
    user_email: str | None = None,
    user: User = Depends(require_permission("system.audit.view")),
    db: AsyncSession = Depends(get_db),
):
    """감사 로그 조회. 필터: action 부분일치, 날짜 범위, sensitive only, user_email 부분일치."""
    from datetime import datetime
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if user_email:
        query = query.where(AuditLog.user_email.ilike(f"%{user_email}%"))
    if sensitive_only:
        query = query.where(AuditLog.is_sensitive == True)
    if date_from:
        try:
            query = query.where(AuditLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            # date_to 끝까지 포함
            end = datetime.fromisoformat(date_to)
            from datetime import timedelta
            query = query.where(AuditLog.timestamp < end + timedelta(days=1))
        except ValueError:
            pass

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(desc(AuditLog.timestamp))
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "user_email": log.user_email,
                "user_role": log.user_role,
                "action": log.action,
                "target": log.target,
                "detail": log.detail,
                "ip": log.ip,
                "is_sensitive": log.is_sensitive,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
    }


# ── 메뉴 숨김 설정 ──

HIDDEN_MENUS_KEY = "hidden_menus"


@router.get("/menu-settings")
async def get_menu_settings(
    db: AsyncSession = Depends(get_db),
):
    """숨겨진 메뉴 목록 반환 (인증 불필요 — 메뉴 렌더링에 필요)"""
    row = (await db.execute(
        select(Setting).where(Setting.key == HIDDEN_MENUS_KEY)
    )).scalar_one_or_none()
    hidden = json.loads(row.value) if row and row.value else []
    return {"hidden_menus": hidden}


@router.put("/menu-settings")
async def update_menu_settings(
    body: dict,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """메뉴 숨김 설정 변경 (관리자 — super_admin + designated_admin)"""
    hidden = body.get("hidden_menus", [])
    row = (await db.execute(
        select(Setting).where(Setting.key == HIDDEN_MENUS_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = json.dumps(hidden)
    else:
        row = Setting(key=HIDDEN_MENUS_KEY, value=json.dumps(hidden))
        db.add(row)
    await db.flush()
    return {"ok": True, "hidden_menus": hidden}


# ── 메뉴 카테고리 관리 ──

MENU_CATEGORIES_KEY = "menu_categories"


class CategoryItem(BaseModel):
    id: str
    name: str
    icon: str
    items: list[str]


class CategoriesBody(BaseModel):
    admin: list[CategoryItem]
    student: list[CategoryItem]


@router.get("/menu-categories")
async def get_menu_categories(
    db: AsyncSession = Depends(get_db),
):
    """메뉴 카테고리 반환 (인증 불필요 — 사이드바 렌더링에 필요)"""
    row = (await db.execute(
        select(Setting).where(Setting.key == MENU_CATEGORIES_KEY)
    )).scalar_one_or_none()
    if row and row.value:
        return json.loads(row.value)
    return None


@router.put("/menu-categories")
async def update_menu_categories(
    body: CategoriesBody,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """메뉴 카테고리 저장 (관리자 — super_admin + designated_admin)"""
    payload = body.model_dump()
    row = (await db.execute(
        select(Setting).where(Setting.key == MENU_CATEGORIES_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = json.dumps(payload)
    else:
        row = Setting(key=MENU_CATEGORIES_KEY, value=json.dumps(payload))
        db.add(row)
    await db.flush()
    return {"ok": True, **payload}


# ── 사이트 브랜딩 (브라우저 탭 제목, 파비콘) ──
#
# Setting 테이블에 저장되는 키:
#   site.title          : 브라우저 탭 제목 (기본 "학교 통합 플랫폼")
#   site.school_name    : 사이드바/UI에 표시되는 학교 이름
#   site.favicon_url    : 파비콘 URL (예: "/storage/branding/favicon.png"). 미설정 시 null

BRANDING_KEYS = ["site.title", "site.school_name", "site.favicon_url"]
ALLOWED_FAVICON_EXTS = {".ico", ".png", ".svg", ".jpg", ".jpeg"}


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return row.value if row and row.value is not None else default


async def _set_setting(db: AsyncSession, key: str, value: str | None) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


@router.get("/branding")
async def get_branding(db: AsyncSession = Depends(get_db)):
    """사이트 브랜딩 조회 — 인증 불필요 (layout metadata에서 SSR 시 호출)"""
    return {
        "title": await _get_setting(db, "site.title", settings.SCHOOL_NAME or "학교 통합 플랫폼"),
        "school_name": await _get_setting(db, "site.school_name", settings.SCHOOL_NAME or "학교"),
        "favicon_url": await _get_setting(db, "site.favicon_url", "") or None,
    }


@router.put("/branding")
async def update_branding(
    body: dict,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """사이트 브랜딩 텍스트 저장 (최고관리자 전용)"""
    if "title" in body:
        await _set_setting(db, "site.title", (body.get("title") or "").strip()[:200])
    if "school_name" in body:
        await _set_setting(db, "site.school_name", (body.get("school_name") or "").strip()[:200])
    await db.flush()
    return {"ok": True}


# ── 교사 열람 범위 정책 ──

from app.core.visibility import get_view_scope, set_view_scope, VALID_SCOPES


@router.get("/policy/teacher-view-scope")
async def get_teacher_view_scope(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """교사가 학생을 어디까지 열람할 수 있는지의 정책 조회."""
    return {
        "scope": await get_view_scope(db),
        "options": [
            {"value": "all", "label": "모든 학생 열람 (기본)"},
            {"value": "scoped", "label": "담당 학생만 (담임/부담임 + 수업 학년·학급)"},
        ],
    }


@router.put("/policy/teacher-view-scope")
async def update_teacher_view_scope(
    body: dict,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """정책 변경. body: {"scope": "all" | "scoped"}"""
    scope = (body.get("scope") or "").strip()
    if scope not in VALID_SCOPES:
        raise HTTPException(400, f"scope must be one of {sorted(VALID_SCOPES)}")
    await set_view_scope(db, scope)
    await db.flush()
    return {"ok": True, "scope": scope}


# ── 전체 백업/복원 (super_admin) ──

from fastapi.responses import Response as FastResponse
from app.services.backup import export_all, restore_all, RestoreError


@router.get("/backup/export")
async def export_backup(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """전체 데이터 + storage 백업 → ZIP 다운로드.

    포함:
      - manifest.json (버전, 날짜, alembic revision, 행수)
      - data.json (모든 테이블, SQLAlchemy 메타데이터 기반 — 새 테이블 자동 포함)
      - storage.tar.gz (사용자 업로드 파일)

    DB 엔진 무관 (SQLite ↔ PostgreSQL 호환).
    """
    zip_bytes = await export_all(db)
    await log_action(db, user, "backup.export", f"size:{len(zip_bytes)}", request=request, is_sensitive=True)
    filename = f"school_backup_{settings.SCHOOL_SHORT}_{__import__('datetime').datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
    return FastResponse(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/backup/restore/preview")
async def restore_preview(
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """복원 미리보기 — 데이터 건드리지 않고 manifest/호환성만 검증."""
    zip_bytes = await file.read()
    try:
        return await restore_all(db, zip_bytes, confirm=False)
    except RestoreError as e:
        raise HTTPException(400, str(e))


@router.post("/backup/restore")
async def restore_apply(
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """실제 복원 — 모든 데이터 wipe 후 백업으로 교체. **돌이킬 수 없음**.

    먼저 /backup/restore/preview로 검증 권장.
    복원 후 alembic 버전이 다르면 백엔드 재시작 + `alembic upgrade head` 실행.
    """
    zip_bytes = await file.read()
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


@router.post("/branding/favicon")
async def upload_favicon(
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """파비콘 업로드 (최고관리자 전용). 기존 파일 덮어씀.
    허용 확장자: .ico, .png, .svg, .jpg, .jpeg / 최대 1MB.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_FAVICON_EXTS:
        raise HTTPException(400, f"허용 확장자: {sorted(ALLOWED_FAVICON_EXTS)}")

    data = await file.read()
    if len(data) > 1_000_000:
        raise HTTPException(400, "파일이 너무 큽니다 (최대 1MB)")
    if not data:
        raise HTTPException(400, "빈 파일")

    BRANDING_DIR.mkdir(parents=True, exist_ok=True)
    # 동일 prefix의 기존 파일 정리 (확장자 다른 경우)
    for old in BRANDING_DIR.glob("favicon.*"):
        try:
            old.unlink()
        except OSError:
            pass

    target = BRANDING_DIR / f"favicon{ext}"
    target.write_bytes(data)

    # cache-busting을 위한 timestamp 쿼리
    import time
    url = f"/storage/branding/favicon{ext}?v={int(time.time())}"
    await _set_setting(db, "site.favicon_url", url)
    await db.flush()
    return {"ok": True, "favicon_url": url}


@router.delete("/branding/favicon")
async def delete_favicon(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """파비콘 제거 (기본값으로 복원)"""
    for old in BRANDING_DIR.glob("favicon.*"):
        try:
            old.unlink()
        except OSError:
            pass
    await _set_setting(db, "site.favicon_url", "")
    await db.flush()
    return {"ok": True}
