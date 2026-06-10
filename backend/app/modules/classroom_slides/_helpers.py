"""classroom_slides 공유 헬퍼.

ClassroomDocument의 _helpers와 동일한 권한 정책. 두 모듈이 거의 같은 패턴이라
향후 공유 mixin으로 리팩토링 후보 (현재는 단순 복사).
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course, CourseStudent
from app.models.classroom_slides import (
    ClassroomPresentation, ClassroomSlide, PresentationMember,
)
from app.models.user import User
from app.services.attachment_share import attachment_share_access


from app.core.permissions import is_admin  # SSOT (re-export)


def deck_to_dict(d: ClassroomPresentation, *, owner_name: str | None = None,
                 slide_count: int | None = None) -> dict:
    return {
        "id": d.id,
        "course_id": d.course_id,
        "owner_id": d.owner_id,
        "owner_name": owner_name,
        "title": d.title,
        "access_mode": d.access_mode,
        "is_archived": d.is_archived,
        "settings": d.settings or {},
        "slide_count": slide_count,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def slide_to_dict(s: ClassroomSlide) -> dict:
    return {
        "id": s.id,
        "presentation_id": s.presentation_id,
        "order": s.order,
        "title": s.title,
        "plain_text": s.plain_text,
        "settings": s.settings or {},
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


async def resolve_permission(
    db: AsyncSession, user: User, deck: ClassroomPresentation,
) -> dict:
    """현재 사용자의 deck 권한.

    정책 — ClassroomDocument와 동일:
    - 소유자: read+write+share
    - 관리자: read+write+share
    - course_members 모드: 강좌 교사 + active 수강생 (편집 가능)
    - specific_users 모드: PresentationMember.role
    - link_public 모드: 인증 사용자 read-only
    """
    if deck.owner_id == user.id:
        return {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}
    if is_admin(user):
        return {"can_read": True, "can_write": True, "can_share": True, "role": "admin"}

    if deck.access_mode == "course_members" and deck.course_id is not None:
        course = await db.get(Course, deck.course_id)
        if course:
            if course.teacher_id == user.id:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
            cs = (await db.execute(
                select(CourseStudent).where(
                    CourseStudent.course_id == deck.course_id,
                    CourseStudent.student_id == user.id,
                    CourseStudent.status == "active",
                )
            )).scalar_one_or_none()
            if cs:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}

    if deck.access_mode == "specific_users":
        m = (await db.execute(
            select(PresentationMember).where(
                PresentationMember.presentation_id == deck.id,
                PresentationMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if m:
            return {
                "can_read": True,
                "can_write": m.role == "editor",
                "can_share": False,
                "role": m.role,
            }

    # 글 첨부 share_mode (Google Classroom '파일 공유 옵션') — additive.
    share = await attachment_share_access(db, user, "deck", deck.id)
    if share == "edit":
        return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
    if share == "view":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    if deck.access_mode == "link_public":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


async def assert_can_read(db: AsyncSession, user: User, deck: ClassroomPresentation) -> dict:
    perm = await resolve_permission(db, user, deck)
    if not perm["can_read"]:
        raise HTTPException(403, "deck 열람 권한이 없습니다")
    return perm


def assert_active_course_or_403(course: Course | None) -> None:
    """학기 보관 정책 (Phase F와 동일)."""
    if course is not None and not course.is_active:
        raise HTTPException(
            409,
            "이 강좌는 보관(inactive) 상태입니다. 강좌 활성화 후 재시도하세요.",
        )
