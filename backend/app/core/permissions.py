"""권한 해석 모듈

설계 원칙:
- 보수적 기본값: 새 권한 키가 추가되면 super_admin + designated_admin만 자동 접근.
  교사/직원/학생에게는 관리자가 명시적으로 role_permissions에 추가해야 노출됨.
- 모듈별 권한 정의: 권한은 `app/modules/{X}/permissions.py`의 `PERMISSIONS` 리스트에 정의.
  자동 수집 — 새 모듈을 만들면 해당 폴더에 permissions.py 만들면 자동으로 시드/UI에 반영.
- 자동 추적: `require_permission("X")`를 호출하는 순간 `_REGISTERED_KEYS`에 자동 등록됨.
  부팅 시 `validate_permission_coverage()`가 코드와 정의를 비교 → 누락이면 RuntimeError.

지정관리자(designated_admin):
- SUPER_ADMIN_ONLY 제외 모든 권한 자동 접근
- 교사/직원/학생의 역할별 권한을 관리할 수 있음

새 모듈 추가하는 AI에게:
- 라우터에서 `require_permission("mymodule.action")` 사용
- `app/modules/mymodule/permissions.py`에 같은 키를 PERMISSIONS 리스트로 정의
- 둘 중 하나라도 빠뜨리면 부팅 시 즉시 알려줌 (RuntimeError 또는 WARN 로그)
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user, verify_2fa_session
from app.models.user import User
from app.models.permission import (
    Permission,
    RolePermission,
    UserPermission,
    UserPermissionGroup,
    PermissionGroupItem,
)

# super_admin 전용 권한 — designated_admin도 접근 불가
SUPER_ADMIN_ONLY_KEYS = {
    "system.health.view",
    "system.logs.view",
    "system.backup.manage",
    "system.settings.edit",
    "system.feature_flags.manage",
    "system.audit.view",
    "permission.manage.view",
    "permission.manage.edit",
    "user.manage.delete",
}

# 라우터에서 require_permission()으로 실제 사용되는 키들 (자동 추적)
# 이 set은 모듈 라우터들이 import될 때 자동으로 채워진다.
_REGISTERED_KEYS: set[str] = set()


def get_registered_keys() -> set[str]:
    """라우터가 require_permission으로 실제 사용한 모든 키"""
    return set(_REGISTERED_KEYS)


# 라우터에서 require_permission()으로 직접 사용하지 않는 키들 (메뉴 표시·매트릭스용)
# 이 목록은 validator의 "사용 안 됨" WARN을 면제받는다.
# 의미:
#   - 일부 권한은 require_permission_manager() / require_super_admin() 등 별도 dependency로 대체됨
#     (그래도 매트릭스 UI / 메뉴 표시에는 등록되어야 함)
#   - 일부 권한은 백엔드 라우터가 아직 미구현이지만 UI에서 미리 노출 (planned)
FRONTEND_ONLY_PERMISSIONS: list[dict] = [
    # 글로벌 — 다른 모듈에 묶기 애매
    {"key": "ranking.view", "display_name": "랭킹 조회", "category": "랭킹"},
    {"key": "student.dashboard.view", "display_name": "학생 대시보드", "category": "학생 대시보드"},
]


async def resolve_permissions(db: AsyncSession, user: User) -> set[str]:
    """사용자의 유효 권한 키 집합을 반환

    해석 순서:
    1. super_admin → 전체 권한 (short-circuit)
    2. designated_admin → 전체 권한 - SUPER_ADMIN_ONLY
    3. teacher/staff/student → role_permissions + user_permissions + user_permission_groups
    """
    if user.role == "super_admin":
        result = await db.execute(select(Permission.key))
        return set(result.scalars().all())

    if user.role == "designated_admin":
        result = await db.execute(select(Permission.key))
        all_keys = set(result.scalars().all())
        return all_keys - SUPER_ADMIN_ONLY_KEYS

    perms: set[str] = set()

    result = await db.execute(
        select(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role == user.role)
    )
    perms.update(result.scalars().all())

    result = await db.execute(
        select(Permission.key)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .where(UserPermission.user_id == user.id)
    )
    perms.update(result.scalars().all())

    result = await db.execute(
        select(Permission.key)
        .join(PermissionGroupItem, PermissionGroupItem.permission_id == Permission.id)
        .join(UserPermissionGroup, UserPermissionGroup.group_id == PermissionGroupItem.group_id)
        .where(UserPermissionGroup.user_id == user.id)
    )
    perms.update(result.scalars().all())

    return perms


def require_permission(permission_key: str):
    """FastAPI dependency — 특정 권한 키가 있어야 접근 허용

    이 함수가 호출되는 순간 permission_key가 _REGISTERED_KEYS에 자동 추적된다.
    부팅 시 validator가 이 키들이 모두 모듈 permissions.py에 정의되어 있는지 검증.
    """
    _REGISTERED_KEYS.add(permission_key)

    async def _check(
        request: Request,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if user.role == "super_admin":
            perm = await _get_permission(db, permission_key)
            if perm and perm.requires_2fa:
                await verify_2fa_session(user, request, db)
            return user

        if user.role == "designated_admin":
            if permission_key in SUPER_ADMIN_ONLY_KEYS:
                raise HTTPException(403, f"최고관리자 전용 권한: {permission_key}")
            perm = await _get_permission(db, permission_key)
            if perm and perm.requires_2fa:
                await verify_2fa_session(user, request, db)
            return user

        user_perms = await resolve_permissions(db, user)
        if permission_key not in user_perms:
            raise HTTPException(403, f"권한 부족: {permission_key}")

        perm = await _get_permission(db, permission_key)
        if perm and perm.requires_2fa:
            await verify_2fa_session(user, request, db)

        return user

    return _check


def require_admin():
    """super_admin 또는 designated_admin만 접근 허용"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("super_admin", "designated_admin"):
            raise HTTPException(403, "관리자 권한이 필요합니다")
        return user
    return _check


def require_super_admin():
    """super_admin만 접근 허용"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role != "super_admin":
            raise HTTPException(403, "최고관리자 권한이 필요합니다")
        return user
    return _check


def require_permission_manager():
    """권한 관리 가능한 사용자 — super_admin은 전체, designated_admin은 하위 역할만"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("super_admin", "designated_admin"):
            raise HTTPException(403, "권한 관리 권한이 필요합니다")
        return user
    return _check


async def _get_permission(db: AsyncSession, key: str) -> Permission | None:
    result = await db.execute(select(Permission).where(Permission.key == key))
    return result.scalar_one_or_none()
