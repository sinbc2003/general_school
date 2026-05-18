"""Shared helpers for auth sub-modules.

다수 sub-module이 공유: user 직렬화 + 2FA 강제 여부 체크.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


def _user_to_dict(
    user: User,
    permissions: set[str] | None = None,
    must_enable_2fa: bool = False,
) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "status": user.status,
        "grade": user.grade,
        "class_number": user.class_number,
        "student_number": user.student_number,
        "department": user.department,
        "totp_enabled": user.totp_enabled,
        "must_change_password": user.must_change_password,
        # admin 2FA 정책 ON + admin role + totp_enabled=False면 True
        # frontend가 이 플래그로 /auth/2fa-setup 강제 redirect.
        "must_enable_2fa": must_enable_2fa,
        "permissions": list(permissions) if permissions else [],
    }


async def _check_must_enable_2fa(user: User, db: AsyncSession) -> bool:
    """admin role이고 2FA 미등록인데 정책이 require면 True."""
    if user.role not in ("super_admin", "designated_admin"):
        return False
    if user.totp_enabled:
        return False
    from app.core.permissions import get_admin_2fa_required
    return await get_admin_2fa_required(db)
