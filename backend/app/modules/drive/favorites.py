"""드라이브 자료 즐겨찾기 (별표).

엔드포인트:
  POST   /api/drive/items/{type}/{id}/favorite  — 토글 (있으면 삭제, 없으면 추가)
  GET    /api/drive/favorites                   — 본인 즐겨찾기 자료 list (drive 통합)

원칙:
  - 본인만 (cross-user 차단)
  - 자료 존재 여부 검사 (없으면 404)
  - 휴지통(deleted_at) 자료도 즐겨찾기 가능 (사용자 자유)
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import User, UserFavoriteItem
from app.modules.drive.router import ITEM_TYPES, router


@router.post("/items/{type}/{item_id}/favorite")
async def toggle_favorite(
    type: str,
    item_id: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """즐겨찾기 toggle — 있으면 해제, 없으면 추가."""
    if type not in ITEM_TYPES:
        raise HTTPException(404, f"알 수 없는 자료 타입: {type}")
    Model, owner_field, label = ITEM_TYPES[type]
    obj = await db.get(Model, item_id)
    if not obj:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    # 본인 자료만 (cross-user 차단 — 자료 권한 검사는 굳이 안 하지만 본인 자료에만 별표)
    if getattr(obj, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 즐겨찾기 추가할 수 있습니다")

    existing = (await db.execute(
        select(UserFavoriteItem).where(
            UserFavoriteItem.user_id == user.id,
            UserFavoriteItem.item_type == type,
            UserFavoriteItem.item_id == item_id,
        )
    )).scalar_one_or_none()

    if existing:
        await db.delete(existing)
        await db.flush()
        await log_action(
            db, user, "drive.favorite.remove",
            target=f"{type}:{item_id}",
        )
        return {"ok": True, "favorited": False}
    else:
        fav = UserFavoriteItem(user_id=user.id, item_type=type, item_id=item_id)
        db.add(fav)
        await db.flush()
        await log_action(
            db, user, "drive.favorite.add",
            target=f"{type}:{item_id}",
        )
        return {"ok": True, "favorited": True}


@router.get("/favorites")
async def list_my_favorites(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 즐겨찾기 자료 list — 단순 {type, id} list.

    Frontend가 set으로 보관 후 ItemRow/ItemCard에 별표 표시.
    """
    rows = (await db.execute(
        select(UserFavoriteItem.item_type, UserFavoriteItem.item_id)
        .where(UserFavoriteItem.user_id == user.id)
        .order_by(UserFavoriteItem.created_at.desc())
    )).all()
    return {
        "items": [{"type": t, "id": i} for t, i in rows],
        "total": len(rows),
    }
