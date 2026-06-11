"""에듀테크 도구 공유 공통 로직 — tool_board / tool_wordbook 라우터가 호출.

도구 row 삭제 시 share row 정리는 라우터 delete에서 cleanup_shares 호출
(tool_id가 다형 FK라 DB CASCADE 불가).
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EduToolShare, User

# 공유 대상 가능 역할 — 교직원만 (학생 공유는 클래스룸 첨부가 담당)
SHAREABLE_ROLES = {"teacher", "staff", "designated_admin", "super_admin"}


async def list_shares(db: AsyncSession, tool_type: str, tool_id: int) -> list[dict]:
    rows = (await db.execute(
        select(EduToolShare, User.name, User.email)
        .join(User, User.id == EduToolShare.user_id)
        .where(
            EduToolShare.tool_type == tool_type,
            EduToolShare.tool_id == tool_id,
        )
        .order_by(EduToolShare.created_at.asc())
    )).all()
    return [
        {
            "id": s.id,
            "user_id": s.user_id,
            "name": name,
            "email": email,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s, name, email in rows
    ]


async def add_share(
    db: AsyncSession, *, tool_type: str, tool_id: int,
    target_user_id: int, shared_by: int,
) -> dict:
    """멱등 — 이미 공유돼 있으면 기존 row 반환."""
    target = await db.get(User, target_user_id)
    if not target:
        raise HTTPException(404, "사용자 없음")
    if target.role not in SHAREABLE_ROLES:
        raise HTTPException(400, "교직원에게만 공유할 수 있습니다")
    if target.id == shared_by:
        raise HTTPException(400, "본인에게는 공유할 수 없습니다")

    existing = (await db.execute(
        select(EduToolShare).where(
            EduToolShare.tool_type == tool_type,
            EduToolShare.tool_id == tool_id,
            EduToolShare.user_id == target_user_id,
        )
    )).scalar_one_or_none()
    if existing:
        return {"id": existing.id, "user_id": target.id, "name": target.name}

    s = EduToolShare(
        tool_type=tool_type, tool_id=tool_id,
        user_id=target_user_id, shared_by=shared_by,
    )
    db.add(s)
    await db.flush()
    return {"id": s.id, "user_id": target.id, "name": target.name}


async def remove_share(
    db: AsyncSession, *, tool_type: str, tool_id: int, share_id: int,
) -> None:
    s = await db.get(EduToolShare, share_id)
    if not s or s.tool_type != tool_type or s.tool_id != tool_id:
        raise HTTPException(404, "공유 없음")
    await db.delete(s)
    await db.flush()


async def is_shared_to(
    db: AsyncSession, tool_type: str, tool_id: int, user_id: int,
) -> bool:
    row = (await db.execute(
        select(EduToolShare.id).where(
            EduToolShare.tool_type == tool_type,
            EduToolShare.tool_id == tool_id,
            EduToolShare.user_id == user_id,
        ).limit(1)
    )).scalar_one_or_none()
    return row is not None


async def shared_tool_ids(
    db: AsyncSession, tool_type: str, user_id: int,
) -> list[int]:
    """나에게 공유된 도구 id 목록."""
    return list((await db.execute(
        select(EduToolShare.tool_id).where(
            EduToolShare.tool_type == tool_type,
            EduToolShare.user_id == user_id,
        )
    )).scalars().all())


async def cleanup_shares(db: AsyncSession, tool_type: str, tool_id: int) -> None:
    """도구 삭제 시 share row 정리 (다형 참조라 DB CASCADE 불가)."""
    await db.execute(delete(EduToolShare).where(
        EduToolShare.tool_type == tool_type,
        EduToolShare.tool_id == tool_id,
    ))
