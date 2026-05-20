"""인사이동 도구 — lifecycle_status 변경 + 자료 소유권 후임자 이관.

엔드포인트:
  PATCH /api/users/{id}/lifecycle       — lifecycle_status 변경 (active/departed/graduated/transferred)
  POST  /api/users/{id}/transfer-ownership — 협업 도구 자료 일괄 owner 변경

정책:
  - lifecycle_status=departed/transferred → 계정 자동 disabled로 함께 설정
  - 자료는 영구 보존 (학교 정책). 후임자에게 owner 이관 시 quota 차감 후임자에게.
  - 마지막 super_admin은 lifecycle 변경 차단.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.quota import release_quota, consume_quota
from app.models import (
    ClassroomDocument, ClassroomPresentation, ClassroomSheet, Survey, User,
)
from app.modules.users._helpers import _ensure_not_last_super_admin, _user_response
from app.modules.users.router import router


VALID_LIFECYCLE = {"active", "departed", "graduated", "transferred"}


class LifecycleUpdate(BaseModel):
    lifecycle_status: str = Field(..., pattern="^(active|departed|graduated|transferred)$")
    disable_account: bool = True  # 함께 status=disabled로 처리할지


class OwnershipTransfer(BaseModel):
    successor_user_id: int = Field(..., gt=0)
    types: list[str] = Field(default_factory=lambda: ["docs", "sheets", "decks", "surveys"])
    include_trash: bool = False  # 휴지통 자료까지 이관할지


@router.patch("/{user_id}/lifecycle")
async def update_lifecycle(
    user_id: int,
    body: LifecycleUpdate,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """인사 상태 변경. departed/graduated/transferred 시 계정 자동 비활성화 (옵션)."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if body.lifecycle_status not in VALID_LIFECYCLE:
        raise HTTPException(400, f"잘못된 lifecycle_status: {body.lifecycle_status}")

    # 마지막 super_admin 보호 (disable이 함께 일어나면 위험)
    if body.disable_account and body.lifecycle_status != "active":
        await _ensure_not_last_super_admin(db, target)

    target.lifecycle_status = body.lifecycle_status
    if body.disable_account and body.lifecycle_status != "active":
        target.status = "disabled"
    elif body.lifecycle_status == "active" and target.status == "disabled":
        target.status = "approved"

    await db.flush()
    await log_action(
        db, user, "user_lifecycle",
        target=target.email,
        detail=f"lifecycle={body.lifecycle_status} disable={body.disable_account}",
        request=request,
    )
    return _user_response(target)


_TYPE_MAP = {
    "docs": (ClassroomDocument, "owner_id"),
    "sheets": (ClassroomSheet, "owner_id"),
    "decks": (ClassroomPresentation, "owner_id"),
    "surveys": (Survey, "author_id"),
}


@router.post("/{user_id}/transfer-ownership")
async def transfer_ownership(
    user_id: int,
    body: OwnershipTransfer,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """자료 소유권을 후임자에게 이관 + quota 재계산.

    - 원 소유자 quota에서 차감 release
    - 후임자 quota에 추가 consume (check=False — admin 작업이므로 한도 무시)
    - file_url 등 storage 경로는 그대로 (DB만 변경)
    """
    source = await db.get(User, user_id)
    successor = await db.get(User, body.successor_user_id)
    if not source:
        raise HTTPException(404, "원 소유자 사용자 없음")
    if not successor:
        raise HTTPException(404, "후임자 사용자 없음")
    if source.id == successor.id:
        raise HTTPException(400, "동일 사용자에게 이관할 수 없습니다")
    # 비활성화/만료된 사용자에게 이관하면 자료가 잠김 — 차단
    if successor.status == "disabled":
        raise HTTPException(400, "비활성화된 사용자에게 이관할 수 없습니다")
    if successor.lifecycle_status in ("departed", "graduated", "transferred"):
        raise HTTPException(400, "재직/재학 중인 사용자에게만 이관할 수 있습니다")

    transferred_count = 0
    transferred_bytes = 0
    by_type: dict[str, int] = {}

    for t in body.types:
        if t not in _TYPE_MAP:
            continue
        Model, owner_field = _TYPE_MAP[t]
        q = select(Model).where(getattr(Model, owner_field) == source.id)
        if not body.include_trash:
            q = q.where(Model.deleted_at.is_(None))
        rows = (await db.execute(q)).scalars().all()
        type_count = 0
        for obj in rows:
            setattr(obj, owner_field, successor.id)
            transferred_bytes += obj.storage_bytes or 0
            transferred_count += 1
            type_count += 1
        by_type[t] = type_count

    await db.flush()

    # quota 조정
    if transferred_bytes > 0:
        await release_quota(db, source, transferred_bytes)
        await consume_quota(db, successor, transferred_bytes, check=False, notify_threshold=False)

    await log_action(
        db, user, "ownership_transfer",
        target=f"{source.email}→{successor.email}",
        detail=f"items={transferred_count} bytes={transferred_bytes}",
        request=request,
    )
    return {
        "ok": True,
        "transferred_count": transferred_count,
        "transferred_bytes": transferred_bytes,
        "by_type": by_type,
        "source": source.email,
        "successor": successor.email,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 만료 임시 계정 자동 비활성화 — notification_scheduler에서 호출
# ─────────────────────────────────────────────────────────────────────────────

async def disable_expired_accounts(db: AsyncSession) -> int:
    """expires_at 도래한 임시·대리 계정을 자동 비활성화. returns 비활성화 수."""
    now = datetime.now(timezone.utc)
    q = (
        update(User)
        .where(
            User.expires_at.isnot(None),
            User.expires_at < now,
            User.status != "disabled",
            User.user_type.in_(["temporary", "substitute"]),
        )
        .values(status="disabled", lifecycle_status="departed")
        .returning(User.id)
    )
    res = await db.execute(q)
    ids = res.scalars().all()
    return len(ids)
