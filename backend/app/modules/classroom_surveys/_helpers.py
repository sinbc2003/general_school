"""classroom_surveys 공유 헬퍼.

라우터 분할(crud/questions/responses/results)에서 공통 사용.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course, CourseStudent
from app.models.classroom_surveys import Survey, SurveyQuestion
from app.models.user import User


def is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


def can_manage(user: User, survey: Survey) -> bool:
    """작성자 또는 관리자만 편집/삭제/결과 조회."""
    return is_admin(user) or survey.author_id == user.id


def survey_to_dict(s: Survey, *, author_name: str | None = None) -> dict:
    return {
        "id": s.id,
        "course_id": s.course_id,
        "author_id": s.author_id,
        "author_name": author_name,
        "title": s.title,
        "description": s.description,
        "status": s.status,
        "is_anonymous": s.is_anonymous,
        "allow_multiple_responses": s.allow_multiple_responses,
        "access_mode": s.access_mode,
        "open_at": s.open_at.isoformat() if s.open_at else None,
        "close_at": s.close_at.isoformat() if s.close_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def question_to_dict(q: SurveyQuestion) -> dict:
    return {
        "id": q.id,
        "survey_id": q.survey_id,
        "order": q.order,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "is_required": q.is_required,
        "options": q.options or [],
        "rating_max": q.rating_max,
    }


async def can_respond(db: AsyncSession, user: User, survey: Survey) -> bool:
    """응답 자격 검증.

    - status=active 필수
    - open_at <= now <= close_at (각각 null이면 무제한)
    - access_mode=course_members: 강좌 학생 OR 교사 OR admin
    - access_mode=link_public: 인증된 모든 사용자
    """
    if survey.status != "active":
        return False
    now = datetime.now(timezone.utc)

    def _aware(dt):
        return dt.replace(tzinfo=timezone.utc) if dt and dt.tzinfo is None else dt

    if survey.open_at and _aware(survey.open_at) > now:
        return False
    if survey.close_at and _aware(survey.close_at) < now:
        return False
    if is_admin(user) or survey.author_id == user.id:
        return True
    if survey.access_mode == "link_public":
        return True
    # course_members
    if survey.course_id is None:
        return False
    course = await db.get(Course, survey.course_id)
    if not course:
        return False
    if course.teacher_id == user.id:
        return True
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == survey.course_id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    return cs is not None


def assert_active_course_or_403(course: Course | None) -> None:
    """학기 보관 정책: course.is_active=false면 새 설문 생성 불가.

    Phase F. course가 None이면 단독 설문 — 호출자에서 별도 처리.
    """
    if course is not None and not course.is_active:
        raise HTTPException(
            409,
            "이 강좌는 보관(inactive) 상태입니다. 강좌 활성화 후 재시도하세요.",
        )
