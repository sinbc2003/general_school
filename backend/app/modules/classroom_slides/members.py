"""Presentation member 관리 — specific_users 모드."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom_slides import ClassroomPresentation, PresentationMember
from app.models.user import User
from app.modules.classroom_slides._helpers import assert_can_read, resolve_permission
from app.modules.classroom_slides.router import router
from app.modules.classroom_slides.schemas import PresentationMemberAdd


@router.get("/{did}/members")
async def list_members(
    did: int,
    user: User = Depends(require_permission("classroom.deck.view")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    await assert_can_read(db, user, d)
    rows = (await db.execute(
        select(PresentationMember, User)
        .join(User, User.id == PresentationMember.user_id)
        .where(PresentationMember.presentation_id == did)
        .order_by(User.name)
    )).all()
    return {
        "items": [
            {
                "id": m.id, "user_id": u.id, "user_name": u.name,
                "role": m.role,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m, u in rows
        ]
    }


@router.post("/{did}/members")
async def add_member(
    did: int, body: PresentationMemberAdd, request: Request,
    user: User = Depends(require_permission("classroom.deck.share")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_share"]:
        raise HTTPException(403)

    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(404, "사용자 없음")

    dup = (await db.execute(
        select(PresentationMember).where(
            PresentationMember.presentation_id == did,
            PresentationMember.user_id == body.user_id,
        )
    )).scalar_one_or_none()
    if dup:
        dup.role = body.role
        await db.flush()
        return {"ok": True, "updated": True}

    m = PresentationMember(presentation_id=did, user_id=body.user_id, role=body.role)
    db.add(m)
    await db.flush()
    await log_action(
        db, user, "classroom.deck.member_add",
        target=f"deck:{did} user:{body.user_id} role:{body.role}", request=request,
    )
    return {"ok": True, "id": m.id}


@router.delete("/{did}/members/{uid}")
async def remove_member(
    did: int, uid: int, request: Request,
    user: User = Depends(require_permission("classroom.deck.share")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_share"]:
        raise HTTPException(403)
    m = (await db.execute(
        select(PresentationMember).where(
            PresentationMember.presentation_id == did,
            PresentationMember.user_id == uid,
        )
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await log_action(
        db, user, "classroom.deck.member_remove",
        target=f"deck:{did} user:{uid}", request=request,
    )
    return {"ok": True}
