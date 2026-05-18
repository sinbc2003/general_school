"""권한 관리 라우터

- super_admin: 모든 역할 + 모든 사용자의 권한 관리
- designated_admin: teacher/staff/student 역할의 권한 관리
- 학기·직책 기반 권한 위임: PositionTemplate CRUD (super_admin/designated_admin)
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user, verify_2fa_session
from app.core.permissions import (
    require_super_admin,
    require_permission_manager,
    resolve_permissions,
    SUPER_ADMIN_ONLY_KEYS,
)
from app.core.audit import log_action
from app.models.user import User
from app.models.permission import (
    Permission,
    RolePermission,
    UserPermission,
    PermissionGroup,
    PermissionGroupItem,
    UserPermissionGroup,
)
from app.models.position import PositionTemplate, EnrollmentPosition
from app.models.timetable import SemesterEnrollment
from app.models.audit import AuditLog

router = APIRouter(prefix="/api/permissions", tags=["permissions"])

MANAGEABLE_ROLES_BY_DESIGNATED = {"teacher", "staff", "student"}


async def _invalidate_user_sessions(db: AsyncSession, user_id: int) -> int:
    """대상 사용자의 모든 refresh token 삭제 → 다음 access token 만료 시 강제 재로그인.

    권한이 변경된 사용자가 stale 권한으로 계속 활동하는 것을 방지.
    access token 자체는 만료될 때까지(보통 15-30분) 유효하지만 refresh 차단으로
    수명 이상 점유 불가. 즉시 차단이 필요하면 access TTL을 짧게 + 권한 거부.
    """
    from sqlalchemy import delete as sql_delete
    from app.models.user import RefreshToken
    result = await db.execute(
        sql_delete(RefreshToken).where(RefreshToken.user_id == user_id)
    )
    return result.rowcount or 0


async def _invalidate_role_sessions(db: AsyncSession, role: str) -> int:
    """특정 role의 모든 사용자 refresh token 삭제 (role_permissions 변경 시)."""
    from sqlalchemy import delete as sql_delete, select as _select
    from app.models.user import RefreshToken, User
    uids = (await db.execute(
        _select(User.id).where(User.role == role)
    )).scalars().all()
    if not uids:
        return 0
    result = await db.execute(
        sql_delete(RefreshToken).where(RefreshToken.user_id.in_(uids))
    )
    return result.rowcount or 0


# ── 권한 키 목록 ──
@router.get("")
async def list_permissions(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """모든 권한 키를 카테고리별로 반환"""
    result = await db.execute(select(Permission).order_by(Permission.category, Permission.key))
    perms = result.scalars().all()

    categories: dict[str, list] = {}
    for p in perms:
        # designated_admin에게는 SUPER_ADMIN_ONLY 권한을 보여주되 편집 불가 표시
        item = {
            "id": p.id,
            "key": p.key,
            "display_name": p.display_name,
            "category": p.category,
            "description": p.description,
            "requires_2fa": p.requires_2fa,
            "is_sensitive": p.is_sensitive,
            "super_admin_only": p.key in SUPER_ADMIN_ONLY_KEYS,
        }
        categories.setdefault(p.category, []).append(item)

    return {"categories": categories}


# ── 역할별 기본 권한 ──
@router.get("/roles/{role}")
async def get_role_permissions(
    role: str,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """특정 역할의 기본 권한 목록"""
    if user.role == "designated_admin" and role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 역할의 권한을 조회할 수 없습니다")

    result = await db.execute(
        select(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role == role)
    )
    keys = list(result.scalars().all())
    return {"role": role, "permissions": keys}


@router.put("/roles/{role}")
async def update_role_permissions(
    role: str,
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """역할의 기본 권한을 업데이트

    body: {"permissions": ["key1", "key2", ...]}
    2FA 필수 (permission.manage.edit requires_2fa).
    """
    await verify_2fa_session(user, request, db)
    if user.role == "designated_admin" and role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 역할의 권한을 수정할 수 없습니다")

    # super_admin role은 변경 불가 (항상 전체 권한)
    if role == "super_admin":
        raise HTTPException(400, "최고관리자 역할은 항상 모든 권한을 가집니다")
    # designated_admin role은 super_admin만 변경 가능 (designated_admin 자기 자신은 권한 상승 위험)
    if role == "designated_admin" and user.role != "super_admin":
        raise HTTPException(403, "지정관리자 역할의 권한은 최고관리자만 변경할 수 있습니다")

    permission_keys = body.get("permissions", [])

    # designated_admin은 SUPER_ADMIN_ONLY 권한을 부여할 수 없음
    if user.role == "designated_admin":
        for key in permission_keys:
            if key in SUPER_ADMIN_ONLY_KEYS:
                raise HTTPException(403, f"최고관리자 전용 권한은 부여할 수 없습니다: {key}")
    # designated_admin role의 권한 셋에는 SUPER_ADMIN_ONLY 키가 들어갈 수 없음 (정책 강제)
    if role == "designated_admin":
        permission_keys = [k for k in permission_keys if k not in SUPER_ADMIN_ONLY_KEYS]

    # 기존 role_permissions 삭제
    await db.execute(
        delete(RolePermission).where(RolePermission.role == role)
    )

    # 새로 추가
    for key in permission_keys:
        perm_result = await db.execute(select(Permission).where(Permission.key == key))
        perm = perm_result.scalar_one_or_none()
        if perm:
            db.add(RolePermission(
                role=role,
                permission_id=perm.id,
                granted_by=user.id,
            ))

    await db.flush()
    invalidated = await _invalidate_role_sessions(db, role)
    await db.flush()
    await log_action(
        db, user, "role_permissions_updated",
        target=f"{role} sessions_invalidated:{invalidated}", request=request,
    )
    return {
        "ok": True, "role": role, "count": len(permission_keys),
        "sessions_invalidated": invalidated,
    }


# ── 역할별 권한 매트릭스 (UI용) ──
@router.get("/matrix")
async def get_permission_matrix(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """전체 권한 매트릭스 — UI의 토글 그리드용.

    designated_admin 컬럼은:
      - super_admin이 보는 경우만 노출
      - 'scoped' 모드일 때만 토글 활성 (full 모드는 자동 부여라 토글 의미 없음)
    """
    from app.core.permissions import get_designated_admin_mode

    # 모든 권한
    result = await db.execute(select(Permission).order_by(Permission.category, Permission.key))
    all_perms = result.scalars().all()

    designated_mode = await get_designated_admin_mode(db)

    # 역할별 부여된 권한 ID
    roles = ["teacher", "staff", "student"]
    if user.role == "super_admin":
        roles = ["designated_admin", "teacher", "staff", "student"]

    role_perm_map: dict[str, set[int]] = {}
    for role in roles:
        result = await db.execute(
            select(RolePermission.permission_id).where(RolePermission.role == role)
        )
        role_perm_map[role] = set(result.scalars().all())

    matrix = []
    for p in all_perms:
        row = {
            "id": p.id,
            "key": p.key,
            "display_name": p.display_name,
            "category": p.category,
            "requires_2fa": p.requires_2fa,
            "super_admin_only": p.key in SUPER_ADMIN_ONLY_KEYS,
        }
        for role in roles:
            row[role] = p.id in role_perm_map.get(role, set())
        matrix.append(row)

    return {
        "roles": roles,
        "matrix": matrix,
        "designated_admin_mode": designated_mode,
    }


# 정책 endpoints는 permissions/policy.py로 분리.


# ── 직책 권한 템플릿 헬퍼 ──
# endpoint들은 permissions/positions.py로 분리됨. 헬퍼만 여기에 유지.

def _parse_permission_keys(raw: str | None) -> list[str]:
    try:
        v = json.loads(raw or "[]")
    except (json.JSONDecodeError, TypeError):
        return []
    return [str(x) for x in v] if isinstance(v, list) else []


async def _validate_permission_keys(
    db: AsyncSession, keys: list[str], requester: User,
) -> list[str]:
    """입력된 권한 키 목록을 검증 + 정리.

    - DB Permission에 정의된 키만 통과 (존재하지 않는 키는 400)
    - designated_admin은 SUPER_ADMIN_ONLY 키 포함 시 403
    """
    if not isinstance(keys, list):
        raise HTTPException(400, "permission_keys는 list여야 합니다")
    cleaned = sorted({str(k).strip() for k in keys if str(k).strip()})

    if requester.role == "designated_admin":
        bad = [k for k in cleaned if k in SUPER_ADMIN_ONLY_KEYS]
        if bad:
            raise HTTPException(
                403, f"최고관리자 전용 권한은 직책 템플릿에 포함할 수 없습니다: {bad}"
            )

    if cleaned:
        valid = set((await db.execute(
            select(Permission.key).where(Permission.key.in_(cleaned))
        )).scalars().all())
        invalid = [k for k in cleaned if k not in valid]
        if invalid:
            raise HTTPException(400, f"존재하지 않는 권한 키: {invalid}")
    return cleaned


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.permissions import positions  # noqa: E402, F401
from app.modules.permissions import policy  # noqa: E402, F401
from app.modules.permissions import audit  # noqa: E402, F401
from app.modules.permissions import user_perms  # noqa: E402, F401
from app.modules.permissions import groups  # noqa: E402, F401
