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
from app.models.position import PositionTemplate, EnrollmentPosition

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


# ── 직책 권한 템플릿 (학기 권한 위임의 근간) ──────────────────────────────
#
# 흐름: super_admin/designated_admin이 직책 템플릿 정의 (예 "1학년 담임")
# → 학기 enrollment에 직책 할당 (timetable router의 positions endpoint)
# → resolve_permissions가 현재 학기 enrollment의 직책 → 권한 키 합산
# → 학기 종료 / enrollment 변경 시 자동 회수.

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


@router.get("/position-templates")
async def list_position_templates(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """모든 직책 템플릿 목록 (UI에서 카테고리별 그룹)."""
    rows = (await db.execute(
        select(PositionTemplate).order_by(
            PositionTemplate.category, PositionTemplate.display_name
        )
    )).scalars().all()

    # 할당된 enrollment 수 — UI에 "사용 중" 표시용
    usage_rows = (await db.execute(
        select(EnrollmentPosition.position_template_id, EnrollmentPosition.id)
    )).all()
    usage: dict[int, int] = {}
    for tid, _ in usage_rows:
        usage[tid] = usage.get(tid, 0) + 1

    items = []
    for p in rows:
        keys = _parse_permission_keys(p.permission_keys)
        items.append({
            "id": p.id,
            "key": p.key,
            "display_name": p.display_name,
            "description": p.description,
            "category": p.category,
            "is_system": p.is_system,
            "permission_keys": keys,
            "permission_count": len(keys),
            "assignment_count": usage.get(p.id, 0),
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        })
    return {"items": items}


@router.post("/position-templates")
async def create_position_template(
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 생성.
    body: {key, display_name, description?, category?, permission_keys: [str]}
    """
    key = (body.get("key") or "").strip()
    display_name = (body.get("display_name") or "").strip()
    if not key or not display_name:
        raise HTTPException(400, "key, display_name 필수")
    if not key.replace("_", "").replace("-", "").replace(".", "").isalnum():
        raise HTTPException(400, "key는 영문/숫자/_/-/. 만 허용됩니다")

    exists = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.key == key)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, f"이미 존재하는 key: {key}")

    perm_keys = await _validate_permission_keys(
        db, body.get("permission_keys", []), user
    )

    p = PositionTemplate(
        key=key,
        display_name=display_name,
        description=(body.get("description") or None),
        category=(body.get("category") or "기타").strip()[:50],
        permission_keys=json.dumps(perm_keys, ensure_ascii=False),
        is_system=False,  # 시스템 템플릿은 시드/마이그레이션에서만 True
        created_by=user.id,
    )
    db.add(p)
    await db.flush()
    await log_action(
        db, user, "position_template.create",
        target=f"key:{key} perms:{len(perm_keys)}", request=request,
    )
    return {"id": p.id, "key": p.key}


@router.put("/position-templates/{tid}")
async def update_position_template(
    tid: int, body: dict, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 수정 (key는 변경 불가 — enrollment 매핑 안전성)."""
    p = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)

    if "display_name" in body:
        p.display_name = (body["display_name"] or "").strip()[:200]
    if "description" in body:
        p.description = body["description"] or None
    if "category" in body:
        p.category = (body["category"] or "기타").strip()[:50]
    if "permission_keys" in body:
        perm_keys = await _validate_permission_keys(db, body["permission_keys"], user)
        p.permission_keys = json.dumps(perm_keys, ensure_ascii=False)

    await db.flush()
    await log_action(
        db, user, "position_template.update",
        target=f"id:{tid}", request=request,
    )
    return {"ok": True}


@router.delete("/position-templates/{tid}")
async def delete_position_template(
    tid: int, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 삭제. 시스템 기본은 삭제 불가.

    cascade=CASCADE로 enrollment_positions의 매핑 행도 자동 정리.
    """
    p = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    if p.is_system:
        raise HTTPException(403, "시스템 기본 템플릿은 삭제할 수 없습니다")

    await db.delete(p)
    await db.flush()
    await log_action(
        db, user, "position_template.delete",
        target=f"id:{tid} key:{p.key}", request=request,
    )
    return {"ok": True}
