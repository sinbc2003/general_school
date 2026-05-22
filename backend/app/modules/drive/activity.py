"""드라이브 활동 로그 — 본인 자료 관련 audit_log 노출.

엔드포인트: GET /api/drive/activity?limit=N&action_prefix=

사용자가 자신의 드라이브 자료에 일어난 변경 이력을 볼 수 있게:
  - 자료 생성/이동/이름변경/복사/삭제(휴지통)/영구삭제/복구
  - 폴더 생성/이름변경/삭제/이동/sync
  - AI 정리 적용/되돌리기
  - 백업 다운로드/복원

audit_log.action 키워드 필터 + user_id == self.
"""

from __future__ import annotations

from fastapi import Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import AuditLog, User
from app.modules.drive.router import router


# 드라이브 활동 관련 action prefix
DRIVE_ACTIONS = [
    "drive.",                # drive.folder.*, drive.item.move, drive.backup.*, drive.batch_organize*
    "drive_soft_delete",     # 휴지통 이동
    "drive_restore",         # 복구
    "drive_permanent_delete",
    "drive_empty_trash",
]


@router.get("/activity")
async def my_drive_activity(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 드라이브 관련 audit_log — 최근부터 N개."""
    conds = [AuditLog.action.like(f"{p}%") for p in DRIVE_ACTIONS]
    q = select(AuditLog).where(
        AuditLog.user_id == user.id,
        or_(*conds),
    ).order_by(AuditLog.created_at.desc()).limit(limit)

    rows = (await db.execute(q)).scalars().all()
    items = [
        {
            "id": r.id,
            "action": r.action,
            "target": r.target,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"items": items, "total": len(items)}
