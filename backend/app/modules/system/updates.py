"""GitHub 업데이트 확인 endpoint — super_admin 전용.

학교 자체 서버 운영 시 GitHub repo 새 commit 감지 + 업데이트 가이드 페이지.
자동 git pull은 안 함 (alembic migration 등 안전성 문제). 사용자가 보고 결정.

엔드포인트:
  GET  /api/system/updates/status      — 현재/원격 commit + 차이 list
  POST /api/system/updates/check-now   — 즉시 polling 강제 (cron 안 기다림)
"""

from __future__ import annotations

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_super_admin
from app.models.user import User
from app.modules.system.router import router
from app.services.github_updates import (
    check_and_notify,
    get_commits_between,
    get_local_commit,
    get_remote_commit,
    is_polling_enabled,
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
