"""사용자 알림 router — 본인 알림만 조회/읽음/삭제.

경로:
  GET    /api/notifications              본인 알림 list (paginate, unread_only 옵션)
  GET    /api/notifications/unread-count 빠른 unread count (사이드바 종 배지용)
  POST   /api/notifications/{nid}/read   단건 읽음 처리
  POST   /api/notifications/read-all     모두 읽음 처리
  DELETE /api/notifications/{nid}        단건 삭제
  DELETE /api/notifications              본인 알림 전체 삭제 (또는 read만)

권한: 인증 사용자 본인 알림만. require_permission 없음.
폴링: frontend는 30~60초 주기로 unread-count 호출 (가벼움).
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.notification import Notification
from app.models.user import User

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _to_dict(n: Notification) -> dict:
    return {
        "id": n.id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "link_url": n.link_url,
        "meta": n.meta or {},
        "is_read": n.is_read,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "source_user_id": n.source_user_id,
    }


@router.get("")
async def list_notifications(
    unread_only: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인 알림 목록 — 최신순."""
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    q = q.order_by(desc(Notification.created_at)).offset(offset).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return {
        "items": [_to_dict(n) for n in rows],
        "limit": limit, "offset": offset,
    }


@router.get("/unread-count")
async def unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인 unread 알림 수 — 사이드바 종 배지용. 가벼운 polling endpoint."""
    cnt = (await db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
        )
    )).scalar_one() or 0
    return {"unread_count": int(cnt)}


@router.post("/{nid}/read")
async def mark_read(
    nid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await db.get(Notification, nid)
    if not n:
        raise HTTPException(404)
    if n.user_id != user.id:
        raise HTTPException(403, "본인 알림만 접근 가능")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.now(timezone.utc)
        await db.flush()
    return {"ok": True, "id": nid, "is_read": True}


@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인의 모든 unread 알림 한 번에 읽음 처리."""
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.is_read.is_(False),
        )
    )).scalars().all()
    for n in rows:
        n.is_read = True
        n.read_at = now
    await db.flush()
    return {"ok": True, "updated": len(rows)}


@router.delete("/{nid}")
async def delete_notification(
    nid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    n = await db.get(Notification, nid)
    if not n:
        raise HTTPException(404)
    if n.user_id != user.id:
        raise HTTPException(403)
    await db.delete(n)
    return {"ok": True}


@router.delete("")
async def clear_notifications(
    only_read: bool = Query(True, description="true=읽은 것만, false=전체"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인 알림 일괄 삭제 (기본: 읽은 것만)."""
    from sqlalchemy import delete
    stmt = delete(Notification).where(Notification.user_id == user.id)
    if only_read:
        stmt = stmt.where(Notification.is_read.is_(True))
    result = await db.execute(stmt)
    await db.flush()
    return {"ok": True, "deleted": result.rowcount or 0}
