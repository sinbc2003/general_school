"""Shared helpers + constants for users sub-modules."""

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


VALID_ROLES = {"super_admin", "designated_admin", "teacher", "staff", "student"}
ADMIN_ROLES = {"super_admin", "designated_admin"}


def _is_admin(u: User) -> bool:
    return u.role in ADMIN_ROLES


async def _count_active_super_admins(
    db: AsyncSession, exclude_user_id: int | None = None,
) -> int:
    """현재 활성(super_admin + approved) 계정 수. 마지막 super_admin 보호용."""
    q = select(func.count(User.id)).where(
        User.role == "super_admin",
        User.status != "disabled",
    )
    if exclude_user_id is not None:
        q = q.where(User.id != exclude_user_id)
    return (await db.execute(q)).scalar() or 0


async def _ensure_not_last_super_admin(db: AsyncSession, target: User) -> None:
    """target의 role/status를 super_admin·active에서 떨어뜨릴 때 호출.
    마지막 활성 super_admin이면 차단 → 시스템 잠김 방지.
    """
    if target.role != "super_admin" or target.status == "disabled":
        return
    others = await _count_active_super_admins(db, exclude_user_id=target.id)
    if others == 0:
        raise HTTPException(
            400,
            "마지막 최고관리자입니다. 다른 super_admin을 먼저 지정한 후 변경하세요.",
        )


def _user_response(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "username": u.username,
        "role": u.role,
        "status": u.status,
        "grade": u.grade,
        "class_number": u.class_number,
        "student_number": u.student_number,
        "department": u.department,
        "department_id": u.department_id,
        "is_grade_lead": u.is_grade_lead,
        "lead_grade": u.lead_grade,
        "user_type": u.user_type,
        "expires_at": u.expires_at.isoformat() if u.expires_at else None,
        "phone": u.phone,
        "google_email": u.google_email,
        "lifecycle_status": u.lifecycle_status,
        "quota_bytes": u.quota_bytes or 0,
        "used_bytes": u.used_bytes or 0,
        "totp_enabled": u.totp_enabled,
        "must_change_password": u.must_change_password,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }
