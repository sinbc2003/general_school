"""Teacher group 공통 헬퍼."""

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.teacher_group import TeacherGroup, TeacherGroupMember
from app.models.user import User

UPLOAD_DIR = os.path.join("storage", "group_submissions")


def is_admin(u: User) -> bool:
    return u.role in ("super_admin", "designated_admin")


async def is_department_lead(db: AsyncSession, u: User) -> bool:
    """부장교사: Department.lead_user_id 매칭."""
    if not u.department_id:
        return False
    dep = await db.get(Department, u.department_id)
    return bool(dep and dep.lead_user_id == u.id)


async def assert_owner_or_admin(group: TeacherGroup, u: User):
    if is_admin(u) or group.owner_id == u.id:
        return
    from fastapi import HTTPException
    raise HTTPException(403, "그룹 owner/admin만 가능합니다")


async def is_group_member(db: AsyncSession, group_id: int, user_id: int) -> bool:
    row = (await db.execute(
        select(TeacherGroupMember).where(
            TeacherGroupMember.group_id == group_id,
            TeacherGroupMember.teacher_id == user_id,
        )
    )).scalar_one_or_none()
    return row is not None


def group_to_dict(g: TeacherGroup, member_count: int = 0, student_count: int = 0) -> dict:
    return {
        "id": g.id,
        "semester_id": g.semester_id,
        "name": g.name,
        "type": g.type,
        "description": g.description,
        "owner_id": g.owner_id,
        "is_active": g.is_active,
        "member_count": member_count,
        "student_count": student_count,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }
