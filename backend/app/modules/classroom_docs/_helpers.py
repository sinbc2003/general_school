"""classroom_docs 공유 헬퍼.

권한 정책의 단일 진실 — 다른 모듈은 resolve_permission만 호출.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course, CourseStudent
from app.models.classroom_docs import ClassroomDocument, DocumentMember
from app.models.user import User
from app.services.attachment_share import attachment_share_access


from app.core.permissions import is_admin  # SSOT (re-export)


def doc_to_dict(d: ClassroomDocument, *, owner_name: str | None = None) -> dict:
    return {
        "id": d.id,
        "course_id": d.course_id,
        "owner_id": d.owner_id,
        "owner_name": owner_name,
        "title": d.title,
        "access_mode": d.access_mode,
        "is_archived": d.is_archived,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


async def resolve_permission(
    db: AsyncSession, user: User, doc: ClassroomDocument,
) -> dict:
    """현재 사용자의 문서 권한 — 모든 endpoint에서 사용.

    returns: {can_read: bool, can_write: bool, can_share: bool,
              role: 'owner'|'admin'|'editor'|'viewer'|None}

    정책:
    - 소유자: 항상 read+write+share
    - 관리자: 항상 read+write+share
    - course_members 모드: 강좌 교사 + active 수강생 (편집 가능)
    - specific_users 모드: DocumentMember.role 따라
    - link_public 모드: 인증된 사용자 read-only
    """
    if doc.owner_id == user.id:
        return {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}
    if is_admin(user):
        return {"can_read": True, "can_write": True, "can_share": True, "role": "admin"}

    if doc.access_mode == "course_members" and doc.course_id is not None:
        course = await db.get(Course, doc.course_id)
        if course:
            if course.teacher_id == user.id:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
            cs = (await db.execute(
                select(CourseStudent).where(
                    CourseStudent.course_id == doc.course_id,
                    CourseStudent.student_id == user.id,
                    CourseStudent.status == "active",
                )
            )).scalar_one_or_none()
            if cs:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}

    if doc.access_mode == "specific_users":
        member = (await db.execute(
            select(DocumentMember).where(
                DocumentMember.document_id == doc.id,
                DocumentMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if member:
            return {
                "can_read": True,
                "can_write": member.role == "editor",
                "can_share": False,
                "role": member.role,
            }

    # 글 첨부 share_mode (Google Classroom '파일 공유 옵션') — additive.
    # 강좌 글에 view/edit로 첨부된 개인 자료는 그 강좌 멤버가 열람/공동편집 가능.
    share = await attachment_share_access(db, user, "doc", doc.id)
    if share == "edit":
        return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
    if share == "view":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    if doc.access_mode == "link_public":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


async def assert_can_read(db: AsyncSession, user: User, doc: ClassroomDocument) -> dict:
    perm = await resolve_permission(db, user, doc)
    if not perm["can_read"]:
        raise HTTPException(403, "문서 열람 권한이 없습니다")
    return perm


def assert_active_course_or_403(course: Course | None) -> None:
    """학기 보관 정책: course.is_active=false면 새 문서 생성 불가 (Phase F)."""
    if course is not None and not course.is_active:
        raise HTTPException(
            409,
            "이 강좌는 보관(inactive) 상태입니다. 강좌 활성화 후 재시도하세요.",
        )
