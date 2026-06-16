"""Survey CRUD — list/create/get/update/delete."""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CourseStudent
from app.models.course_teacher import CourseTeacher
from sqlalchemy import func as sa_func

from app.models.classroom_surveys import Survey, SurveyQuestion, SurveyResponse
from app.models.user import User
from app.modules.classroom_surveys._helpers import (
    assert_active_course_or_403, can_manage, can_respond, is_admin,
    question_to_dict, response_editable_until, survey_to_dict,
)
from app.modules.classroom_surveys.router import router
from app.modules.classroom_surveys.schemas import SurveyCreate, SurveyUpdate


@router.get("")
async def list_surveys(
    course_id: int | None = Query(None),
    mine: bool = Query(False, description="True면 내가 만든 설문만"),
    status_filter: str | None = Query(None, alias="status"),
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 접근 가능한 설문 목록.

    - 작성자 OR 강좌 멤버 OR admin OR (link_public + active)
    """
    base = select(Survey)
    if course_id is not None:
        base = base.where(Survey.course_id == course_id)
    if status_filter:
        base = base.where(Survey.status == status_filter)

    if is_admin(user):
        q = base
    elif mine:
        q = base.where(Survey.author_id == user.id)
    else:
        teacher_course_ids = (await db.execute(
            select(Course.id).where(or_(
                Course.teacher_id == user.id,
                Course.id.in_(
                    select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
                ),
            ))
        )).scalars().all()
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        conds = [Survey.author_id == user.id]
        if course_ids:
            conds.append(
                (Survey.access_mode == "course_members") &
                (Survey.course_id.in_(course_ids))
            )
        conds.append(
            (Survey.access_mode == "link_public") & (Survey.status == "active")
        )
        q = base.where(or_(*conds))

    q = q.order_by(desc(Survey.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    author_ids = {s.author_id for s in rows}
    authors: dict[int, str] = {}
    if author_ids:
        urows = (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all()
        authors = {u.id: u.name for u in urows}

    return {"items": [survey_to_dict(s, author_name=authors.get(s.author_id)) for s in rows]}


@router.post("")
async def create_survey(
    body: SurveyCreate, request: Request,
    user: User = Depends(require_permission("classroom.survey.create")),
    db: AsyncSession = Depends(get_db),
):
    course: Course | None = None
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌만 설문 생성 가능")
        # Phase F: archived 강좌는 새 설문 생성 차단
        assert_active_course_or_403(course)

    s = Survey(
        course_id=body.course_id,
        author_id=user.id,
        title=body.title,
        description=body.description,
        is_anonymous=body.is_anonymous,
        allow_multiple_responses=body.allow_multiple_responses,
        access_mode=body.access_mode,
    )
    db.add(s)
    await db.flush()
    await log_action(
        db, user, "classroom.survey.create",
        target=f"survey:{s.id}", request=request,
    )
    return survey_to_dict(s, author_name=user.name)


@router.get("/{sid}")
async def get_survey(
    sid: int,
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)

    is_author = can_manage(user, s)
    can_respond_now = await can_respond(db, user, s)
    if not is_author and not can_respond_now:
        raise HTTPException(403, "설문 접근 권한이 없습니다")

    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
        .order_by(SurveyQuestion.order, SurveyQuestion.id)
    )).scalars().all()

    my_response = None
    if not s.is_anonymous:
        mr = (await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == sid,
                SurveyResponse.respondent_id == user.id,
            ).order_by(desc(SurveyResponse.submitted_at)).limit(1)
        )).scalar_one_or_none()
        if mr:
            editable_until = response_editable_until(s, mr.submitted_at)
            my_response = {
                "id": mr.id,
                "submitted_at": mr.submitted_at.isoformat() if mr.submitted_at else None,
                "editable_until": editable_until.isoformat() if editable_until else None,
            }

    author = await db.get(User, s.author_id)

    # 작성자/관리자에게는 응답 카운트 노출 — 탭 배지 표시용
    response_count: int | None = None
    if is_author:
        response_count = (await db.execute(
            select(sa_func.count(SurveyResponse.id)).where(SurveyResponse.survey_id == sid)
        )).scalar_one()

    return {
        **survey_to_dict(s, author_name=author.name if author else None),
        "questions": [question_to_dict(q) for q in qs],
        "is_author": is_author,
        "can_respond": can_respond_now and (s.allow_multiple_responses or my_response is None),
        "my_response": my_response,
        "response_count": response_count,
    }


@router.put("/{sid}")
async def update_survey(
    sid: int, body: SurveyUpdate, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not can_manage(user, s):
        raise HTTPException(403, "본인 설문만 편집 가능")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(s, k, v)
    await db.flush()
    await log_action(db, user, "classroom.survey.update", target=f"survey:{sid}", request=request)
    return survey_to_dict(s)


@router.delete("/{sid}")
async def delete_survey(
    sid: int, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not can_manage(user, s):
        raise HTTPException(403, "본인 설문만 삭제 가능")
    await db.delete(s)
    await log_action(db, user, "classroom.survey.delete", target=f"survey:{sid}", request=request)
    return {"ok": True}
