"""GitHub 업데이트 확인 + 자동 적용 endpoint — super_admin 전용.

학교 자체 서버 운영 시 GitHub repo 새 commit 감지.

엔드포인트:
  GET  /api/system/updates/status      — 현재/원격 commit + 차이 list
  POST /api/system/updates/check-now   — 즉시 polling 강제 (cron 안 기다림)
  POST /api/system/updates/apply       — 자동 적용 (백업+pull+build+restart+rollback)
  GET  /api/system/updates/progress    — 진행 중 업데이트 상태 (polling용)
  GET  /api/system/updates/last        — 마지막 업데이트 실행 결과

apply 흐름:
  0. lock (동시 실행 차단) — /tmp/gs-update.lock
  1. 백업 (pg_dump + storage)
  2. git pull
  3. pip install + alembic upgrade head
  4. npm ci --legacy-peer-deps + build
  5. systemctl restart gs-backend gs-frontend gs-hocuspocus
  6. /api/health 200 OK 확인 (60초 안)
  7. 실패 시 자동 rollback (git reset + pg_restore + restart)

데이터 안전성:
  - 시작 전 백업 → 어떤 실패에도 데이터 손실 0
  - alembic 마이그레이션은 보통 컬럼 추가만 → 기존 데이터 보존
  - systemctl restart 시 1~5초 다운타임 (Yjs/세션 자동 재연결)
"""

from __future__ import annotations

import asyncio

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import async_session_factory, get_db
from app.core.permissions import require_permission, require_super_admin
from app.models.user import User
from app.modules.system.router import router
from app.services.github_updates import (
    check_and_notify,
    get_commits_between,
    get_local_commit,
    get_remote_commit,
    is_polling_enabled,
)
from app.services.update_executor import (
    apply_update,
    get_last_result,
    get_progress,
    is_running,
)


@router.get("/updates/status")
async def get_updates_status(
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """현재 commit + GitHub HEAD + 차이 commit list 조회 (호출 시 알림 발송 X).

    GITHUB_UPDATE_REPO env 미설정 시 `enabled: false`로 응답 → frontend가
    "환경변수 안내" 페이지 표시.
    """
    enabled = is_polling_enabled()
    if not enabled:
        return {
            "enabled": False,
            "local": None,
            "remote": None,
            "commits": [],
            "behind_count": 0,
        }

    local = await get_local_commit()
    remote = await get_remote_commit()
    commits: list[dict] = []
    behind = 0
    if local and remote and local.get("sha") != remote.get("sha"):
        commits = await get_commits_between(local["sha"], remote["sha"], limit=20)
        behind = len(commits) if commits else 1

    return {
        "enabled": True,
        "local": local,
        "remote": remote,
        "commits": commits,
        "behind_count": behind,
    }


@router.post("/updates/check-now")
async def force_check_updates(
    request: Request,
    user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """즉시 polling 실행 + (새 commit이면) 알림 발송. cron 안 기다림.

    수동 trigger도 같은 헬퍼 호출 → 중복 알림 방지 (last_notified_remote_sha 비교).
    """
    result = await check_and_notify(db)
    await log_action(
        db, user, "system.update_check_now",
        detail=(
            f"behind={result.get('behind_count', 0)} "
            f"notified={result.get('notified', False)}"
        ),
        request=request,
    )
    return result


# ── 자동 적용 (apply) + 진행 상황 polling ──

async def _run_update_in_background(user_id: int, dry_run: bool) -> None:
    """백그라운드 task — 별도 DB 세션으로 실행 (요청 끝나도 계속)."""
    async with async_session_factory() as session:
        try:
            await apply_update(session, user_id=user_id, dry_run=dry_run)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("apply_update crashed")


@router.post("/updates/apply")
async def trigger_apply(
    request: Request,
    dry_run: bool = False,
    user: User = Depends(require_permission("system.updates.apply")),
    db: AsyncSession = Depends(get_db),
):
    """업데이트 자동 적용 시작 (백그라운드).

    Args:
      - dry_run: True면 백업만 + 변경 미리보기 (실제 적용 X). 안전 테스트용.

    응답: `{started: true, dry_run: bool}` — 진행 상황은 /updates/progress polling.

    동시 실행 차단: 이미 진행 중이면 409 conflict.
    """
    if is_running():
        raise HTTPException(409, "이미 진행 중인 업데이트가 있습니다")
    if not is_polling_enabled():
        raise HTTPException(
            400, "GITHUB_UPDATE_REPO env 미설정 — .env에 추가 후 backend 재시작 필요",
        )

    await log_action(
        db, user, "system.update_apply_start",
        detail=f"dry_run={dry_run}",
        request=request,
        is_sensitive=True,
    )
    await db.commit()

    # 백그라운드 시작 (요청 응답은 즉시)
    asyncio.create_task(_run_update_in_background(user.id, dry_run))
    return {"started": True, "dry_run": dry_run}


@router.get("/updates/progress")
async def get_update_progress(
    user: User = Depends(require_permission("system.updates.apply")),
    db: AsyncSession = Depends(get_db),
):
    """진행 중인 업데이트 상태. 없으면 `running: false`."""
    p = await get_progress(db)
    if not p:
        return {"running": False, "exists": False}
    return {"exists": True, **p}


@router.get("/updates/last")
async def get_last_update_result(
    user: User = Depends(require_permission("system.updates.view")),
    db: AsyncSession = Depends(get_db),
):
    """마지막 업데이트 실행 결과 (성공/실패)."""
    r = await get_last_result(db)
    return r or {"exists": False}
