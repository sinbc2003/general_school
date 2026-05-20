"""슬라이드 CRUD + 순서 변경."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom_slides import ClassroomPresentation, ClassroomSlide
from app.models.user import User
from app.modules.classroom_slides._helpers import resolve_permission, slide_to_dict
from app.modules.classroom_slides.router import router
from app.modules.classroom_slides.schemas import (
    SlideCreate, SlideReorder, SlideUpdate,
)


@router.post("/{did}/slides")
async def add_slide(
    did: int, body: SlideCreate, request: Request,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")

    next_order = body.order
    if next_order is None:
        max_order = (await db.execute(
            select(func.coalesce(func.max(ClassroomSlide.order), -1)).where(
                ClassroomSlide.presentation_id == did,
            )
        )).scalar_one()
        next_order = (max_order or -1) + 1
    else:
        # 지정 위치 — 그 이후 슬라이드 모두 +1
        await db.execute(
            ClassroomSlide.__table__.update()
            .where(
                ClassroomSlide.presentation_id == did,
                ClassroomSlide.order >= next_order,
            )
            .values(order=ClassroomSlide.order + 1)
        )

    s = ClassroomSlide(
        presentation_id=did,
        order=next_order,
        title=body.title,
    )
    db.add(s)
    await db.flush()
    await log_action(
        db, user, "classroom.slide.add",
        target=f"deck:{did} slide:{s.id} order:{next_order}", request=request,
    )
    return slide_to_dict(s)


@router.put("/slides/{sid}")
async def update_slide(
    sid: int, body: SlideUpdate,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(ClassroomSlide, sid)
    if not s:
        raise HTTPException(404)
    d = await db.get(ClassroomPresentation, s.presentation_id)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403)
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(s, k, v)
    await db.flush()
    # onupdate=func.now() expire 회피 (MissingGreenlet 방지)
    await db.refresh(s)
    return slide_to_dict(s)


@router.delete("/slides/{sid}")
async def delete_slide(
    sid: int,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(ClassroomSlide, sid)
    if not s:
        raise HTTPException(404)
    d = await db.get(ClassroomPresentation, s.presentation_id)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403)

    # 마지막 슬라이드 삭제 차단 (deck에는 최소 1장)
    cnt = (await db.execute(
        select(func.count(ClassroomSlide.id)).where(
            ClassroomSlide.presentation_id == s.presentation_id,
        )
    )).scalar_one()
    if cnt <= 1:
        raise HTTPException(409, "deck에는 최소 1장의 슬라이드가 필요합니다")

    deleted_order = s.order
    await db.delete(s)
    # 뒤 슬라이드들 order -1
    await db.execute(
        ClassroomSlide.__table__.update()
        .where(
            ClassroomSlide.presentation_id == d.id,
            ClassroomSlide.order > deleted_order,
        )
        .values(order=ClassroomSlide.order - 1)
    )
    await db.flush()
    return {"ok": True}


@router.post("/{did}/slides/_reorder")
async def reorder_slides(
    did: int, body: SlideReorder, request: Request,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    """슬라이드 일괄 순서 변경.

    body.order: 새 순서대로 slide_id 나열. 각 id가 그 위치(0-indexed)로 reorder.
    누락된 slide는 그대로 두지 않고 409 (모든 deck slide 포함 必).
    """
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403)

    existing = (await db.execute(
        select(ClassroomSlide).where(ClassroomSlide.presentation_id == did)
    )).scalars().all()
    existing_ids = {s.id for s in existing}
    given = set(body.order)

    if existing_ids != given:
        raise HTTPException(
            409,
            f"reorder는 deck의 모든 슬라이드를 정확히 한 번씩 포함해야 합니다 "
            f"(기존 {len(existing_ids)}장, 입력 {len(given)}건).",
        )
    by_id = {s.id: s for s in existing}
    for i, sid in enumerate(body.order):
        by_id[sid].order = i
    await db.flush()
    await log_action(
        db, user, "classroom.deck.reorder",
        target=f"deck:{did} count:{len(body.order)}", request=request,
    )
    return {"ok": True}
