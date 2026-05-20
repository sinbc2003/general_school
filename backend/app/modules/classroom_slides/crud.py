"""Presentation deck CRUD + 슬라이드 list."""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CourseStudent
from app.models.classroom_slides import (
    ClassroomPresentation, ClassroomSlide, PresentationMember,
)
from app.models.user import User
from app.modules.classroom_slides._helpers import (
    assert_active_course_or_403, assert_can_read, deck_to_dict, is_admin,
    resolve_permission, slide_to_dict,
)
from app.modules.classroom_slides.router import router
from app.modules.classroom_slides.schemas import (
    PresentationCreate, PresentationUpdate,
)


@router.get("")
async def list_decks(
    course_id: int | None = Query(None),
    include_archived: bool = Query(False),
    mine: bool = Query(False, description="True면 본인이 만든 deck만"),
    user: User = Depends(require_permission("classroom.deck.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 접근 가능한 deck 목록. mine=true면 본인 작성만."""
    base = select(ClassroomPresentation)
    if course_id is not None:
        base = base.where(ClassroomPresentation.course_id == course_id)
    if not include_archived:
        base = base.where(ClassroomPresentation.is_archived.is_(False))

    if mine:
        q = base.where(ClassroomPresentation.owner_id == user.id)
    elif is_admin(user):
        q = base
    else:
        teacher_course_ids = (await db.execute(
            select(Course.id).where(Course.teacher_id == user.id)
        )).scalars().all()
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        member_deck_ids = (await db.execute(
            select(PresentationMember.presentation_id).where(
                PresentationMember.user_id == user.id,
            )
        )).scalars().all()

        conds = [ClassroomPresentation.owner_id == user.id]
        if course_ids:
            conds.append(
                (ClassroomPresentation.access_mode == "course_members") &
                (ClassroomPresentation.course_id.in_(course_ids))
            )
        if member_deck_ids:
            conds.append(ClassroomPresentation.id.in_(member_deck_ids))
        q = base.where(or_(*conds))

    q = q.order_by(desc(ClassroomPresentation.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    # 슬라이드 수 집계
    counts: dict[int, int] = {}
    if rows:
        cnt_q = (await db.execute(
            select(ClassroomSlide.presentation_id, func.count(ClassroomSlide.id))
            .where(ClassroomSlide.presentation_id.in_([d.id for d in rows]))
            .group_by(ClassroomSlide.presentation_id)
        )).all()
        counts = dict(cnt_q)

    owner_ids = {d.owner_id for d in rows}
    owners: dict[int, str] = {}
    if owner_ids:
        urows = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owners = {u.id: u.name for u in urows}

    return {
        "items": [
            deck_to_dict(
                d, owner_name=owners.get(d.owner_id),
                slide_count=counts.get(d.id, 0),
            ) for d in rows
        ]
    }


@router.post("")
async def create_deck(
    body: PresentationCreate, request: Request,
    user: User = Depends(require_permission("classroom.deck.create")),
    db: AsyncSession = Depends(get_db),
):
    course: Course | None = None
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌만 deck 생성 가능 (학생은 단독만)")
        assert_active_course_or_403(course)

    d = ClassroomPresentation(
        course_id=body.course_id,
        owner_id=user.id,
        title=body.title,
        access_mode=body.access_mode,
    )
    db.add(d)
    await db.flush()

    # 첫 빈 슬라이드 자동 추가 (Google Slides 동작과 동일)
    db.add(ClassroomSlide(
        presentation_id=d.id, order=0, title="제목 슬라이드",
    ))
    await db.flush()

    await log_action(
        db, user, "classroom.deck.create",
        target=f"deck:{d.id} course:{body.course_id}", request=request,
    )
    return deck_to_dict(d, owner_name=user.name, slide_count=1)


@router.get("/{did}")
async def get_deck(
    did: int,
    user: User = Depends(require_permission("classroom.deck.view")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await assert_can_read(db, user, d)

    slides = (await db.execute(
        select(ClassroomSlide).where(ClassroomSlide.presentation_id == did)
        .order_by(ClassroomSlide.order, ClassroomSlide.id)
    )).scalars().all()

    owner = await db.get(User, d.owner_id)
    return {
        **deck_to_dict(d, owner_name=owner.name if owner else None, slide_count=len(slides)),
        "slides": [slide_to_dict(s) for s in slides],
        "permission": perm,
    }


@router.put("/{did}")
async def update_deck(
    did: int, body: PresentationUpdate, request: Request,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")
    if body.access_mode is not None and body.access_mode != d.access_mode:
        if not perm["can_share"]:
            raise HTTPException(403, "공유 설정 변경은 소유자/관리자만")
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(d, k, v)
    await db.flush()
    # onupdate=func.now()로 updated_at이 expired 상태 — async refresh로
    # 명시 reload 안 하면 deck_to_dict의 attribute access가 sync IO 시도해
    # MissingGreenlet 발생.
    await db.refresh(d)
    await log_action(db, user, "classroom.deck.update", target=f"deck:{did}", request=request)
    owner = await db.get(User, d.owner_id)
    return deck_to_dict(d, owner_name=owner.name if owner else None)


@router.delete("/{did}")
async def delete_deck(
    did: int, request: Request,
    user: User = Depends(require_permission("classroom.deck.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    if d.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "소유자 또는 관리자만 삭제 가능")
    await db.delete(d)
    await log_action(db, user, "classroom.deck.delete", target=f"deck:{did}", request=request)
    return {"ok": True}
