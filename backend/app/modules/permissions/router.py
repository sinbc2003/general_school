"""권한 관리 라우터

- super_admin: 모든 역할 + 모든 사용자의 권한 관리
- designated_admin: teacher/staff/student 역할의 권한 관리
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user
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

router = APIRouter(prefix="/api/permissions", tags=["permissions"])

MANAGEABLE_ROLES_BY_DESIGNATED = {"teacher", "staff", "student"}


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
    """
    if user.role == "designated_admin" and role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 역할의 권한을 수정할 수 없습니다")

    if role in ("super_admin", "designated_admin"):
        raise HTTPException(400, "관리자 역할의 기본 권한은 변경할 수 없습니다")

    permission_keys = body.get("permissions", [])

    # designated_admin은 SUPER_ADMIN_ONLY 권한을 부여할 수 없음
    if user.role == "designated_admin":
        for key in permission_keys:
            if key in SUPER_ADMIN_ONLY_KEYS:
                raise HTTPException(403, f"최고관리자 전용 권한은 부여할 수 없습니다: {key}")

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
    await log_action(db, user, "role_permissions_updated", target=role, request=request)
    return {"ok": True, "role": role, "count": len(permission_keys)}


# ── 역할별 권한 매트릭스 (UI용) ──
@router.get("/matrix")
async def get_permission_matrix(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """전체 권한 매트릭스 — UI의 토글 그리드용"""
    # 모든 권한
    result = await db.execute(select(Permission).order_by(Permission.category, Permission.key))
    all_perms = result.scalars().all()

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

    return {"roles": roles, "matrix": matrix}


# ── 개별 사용자 권한 ──
@router.get("/users/{user_id}")
async def get_user_permissions(
    user_id: int,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """특정 사용자의 유효 권한 반환"""
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    if user.role == "designated_admin" and target.role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 사용자의 권한을 조회할 수 없습니다")

    effective = await resolve_permissions(db, target)

    # 개인 추가 권한만 별도로 조회
    result = await db.execute(
        select(Permission.key)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .where(UserPermission.user_id == user_id)
    )
    individual = list(result.scalars().all())

    # 그룹 권한
    result = await db.execute(
        select(PermissionGroup.id, PermissionGroup.name)
        .join(UserPermissionGroup, UserPermissionGroup.group_id == PermissionGroup.id)
        .where(UserPermissionGroup.user_id == user_id)
    )
    groups = [{"id": r[0], "name": r[1]} for r in result.all()]

    return {
        "user_id": user_id,
        "role": target.role,
        "effective_permissions": sorted(effective),
        "individual_permissions": individual,
        "permission_groups": groups,
    }


@router.put("/users/{user_id}")
async def update_user_permissions(
    user_id: int,
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """사용자 개별 권한 설정

    body: {"permissions": ["key1", "key2", ...]}
    """
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404)

    if user.role == "designated_admin" and target.role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 사용자의 권한을 수정할 수 없습니다")

    permission_keys = body.get("permissions", [])

    # designated_admin은 SUPER_ADMIN_ONLY 권한 부여 불가
    if user.role == "designated_admin":
        for key in permission_keys:
            if key in SUPER_ADMIN_ONLY_KEYS:
                raise HTTPException(403, f"최고관리자 전용 권한: {key}")

    # 기존 개인 권한 삭제
    await db.execute(
        delete(UserPermission).where(UserPermission.user_id == user_id)
    )

    for key in permission_keys:
        perm_result = await db.execute(select(Permission).where(Permission.key == key))
        perm = perm_result.scalar_one_or_none()
        if perm:
            db.add(UserPermission(
                user_id=user_id,
                permission_id=perm.id,
                granted_by=user.id,
            ))

    await db.flush()
    await log_action(db, user, "user_permissions_updated", target=str(user_id), request=request)
    return {"ok": True}


# ── 권한 그룹 ──
@router.get("/groups")
async def list_groups(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PermissionGroup).order_by(PermissionGroup.name))
    groups = result.scalars().all()

    items = []
    for g in groups:
        perm_result = await db.execute(
            select(Permission.key)
            .join(PermissionGroupItem, PermissionGroupItem.permission_id == Permission.id)
            .where(PermissionGroupItem.group_id == g.id)
        )
        keys = list(perm_result.scalars().all())
        items.append({
            "id": g.id,
            "name": g.name,
            "description": g.description,
            "permissions": keys,
            "permission_count": len(keys),
        })

    return {"groups": items}


@router.post("/groups")
async def create_group(
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    group = PermissionGroup(
        name=body["name"],
        description=body.get("description"),
        created_by=user.id,
    )
    db.add(group)
    await db.flush()

    for key in body.get("permissions", []):
        perm_result = await db.execute(select(Permission).where(Permission.key == key))
        perm = perm_result.scalar_one_or_none()
        if perm:
            db.add(PermissionGroupItem(group_id=group.id, permission_id=perm.id))

    await db.flush()
    await log_action(db, user, "permission_group_created", target=body["name"], request=request)
    return {"id": group.id, "name": group.name}


@router.put("/groups/{group_id}")
async def update_group(
    group_id: int,
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PermissionGroup).where(PermissionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(404)

    if "name" in body:
        group.name = body["name"]
    if "description" in body:
        group.description = body["description"]

    if "permissions" in body:
        await db.execute(
            delete(PermissionGroupItem).where(PermissionGroupItem.group_id == group_id)
        )
        for key in body["permissions"]:
            perm_result = await db.execute(select(Permission).where(Permission.key == key))
            perm = perm_result.scalar_one_or_none()
            if perm:
                db.add(PermissionGroupItem(group_id=group_id, permission_id=perm.id))

    await db.flush()
    await log_action(db, user, "permission_group_updated", target=str(group_id), request=request)
    return {"ok": True}


@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: int,
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PermissionGroup).where(PermissionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(404)

    await db.execute(delete(PermissionGroupItem).where(PermissionGroupItem.group_id == group_id))
    await db.execute(delete(UserPermissionGroup).where(UserPermissionGroup.group_id == group_id))
    await db.delete(group)
    await db.flush()
    await log_action(db, user, "permission_group_deleted", target=str(group_id), request=request)
    return {"ok": True}


@router.post("/groups/{group_id}/assign")
async def assign_group_to_user(
    group_id: int,
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """권한 그룹을 사용자에게 할당

    body: {"user_id": 123}
    """
    target_user_id = body.get("user_id")
    if not target_user_id:
        raise HTTPException(400, "user_id 필요")

    # 그룹 존재 확인
    result = await db.execute(select(PermissionGroup).where(PermissionGroup.id == group_id))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "그룹 없음")

    # 대상 사용자 확인
    result = await db.execute(select(User).where(User.id == target_user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자 없음")

    if user.role == "designated_admin" and target.role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 사용자에게 그룹을 할당할 수 없습니다")

    # 중복 체크
    result = await db.execute(
        select(UserPermissionGroup).where(
            UserPermissionGroup.user_id == target_user_id,
            UserPermissionGroup.group_id == group_id,
        )
    )
    if result.scalar_one_or_none():
        return {"ok": True, "message": "이미 할당됨"}

    db.add(UserPermissionGroup(
        user_id=target_user_id,
        group_id=group_id,
        granted_by=user.id,
    ))
    await db.flush()
    await log_action(db, user, "permission_group_assigned",
                     target=f"user:{target_user_id} group:{group_id}", request=request)
    return {"ok": True}
