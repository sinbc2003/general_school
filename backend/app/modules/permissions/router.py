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
# (designated_admin_mode / admin_2fa_required / password policy)


# ── 개별 사용자 권한 ──
@router.get("/users/{user_id}")
async def get_user_permissions(
    user_id: int,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """특정 사용자의 유효 권한 + **출처별 상세** 반환.

    응답:
      effective_permissions: 유효 권한 키 목록 (정렬)
      sources:
        role: 이 사용자의 role 기본 권한 키 목록
        user: user_permissions 테이블의 개별 부여 키 목록
        groups: [{id, name, permissions: [key, ...]}]
        positions: [{id, key, display_name, semester_id, semester_name, permissions: [key, ...]}]
      permission_sources: {key: [source_tag, ...]} — 권한별 출처 추적용
        source_tag 예: "role:teacher", "user", "group:1", "position:3"
    """
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    if user.role == "designated_admin" and target.role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 사용자의 권한을 조회할 수 없습니다")

    effective = await resolve_permissions(db, target)

    # 출처별 권한 키 수집
    perm_sources: dict[str, list[str]] = {k: [] for k in effective}

    # 1) role 기본 권한 (super_admin/designated_admin은 special — 'role:auto'로 표시)
    role_keys: list[str] = []
    if target.role == "super_admin":
        role_keys = sorted(effective)
        for k in role_keys:
            perm_sources.setdefault(k, []).append("role:super_admin (auto)")
    elif target.role == "designated_admin":
        from app.core.permissions import get_designated_admin_mode
        mode = await get_designated_admin_mode(db)
        if mode == "full":
            role_keys = sorted(effective)
            for k in role_keys:
                perm_sources.setdefault(k, []).append(f"role:designated_admin (mode=full)")
        else:
            # scoped 모드 — 일반 역할처럼 role_permissions 사용
            rows = (await db.execute(
                select(Permission.key)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .where(RolePermission.role == "designated_admin")
            )).scalars().all()
            role_keys = sorted(rows)
            for k in role_keys:
                perm_sources.setdefault(k, []).append(f"role:designated_admin (mode=scoped)")
    else:
        rows = (await db.execute(
            select(Permission.key)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role == target.role)
        )).scalars().all()
        role_keys = sorted(rows)
        for k in role_keys:
            perm_sources.setdefault(k, []).append(f"role:{target.role}")

    # 2) user_permissions
    user_keys = list((await db.execute(
        select(Permission.key)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .where(UserPermission.user_id == user_id)
    )).scalars().all())
    for k in user_keys:
        perm_sources.setdefault(k, []).append("user (개별 부여)")

    # 3) permission_groups
    group_rows = (await db.execute(
        select(PermissionGroup.id, PermissionGroup.name)
        .join(UserPermissionGroup, UserPermissionGroup.group_id == PermissionGroup.id)
        .where(UserPermissionGroup.user_id == user_id)
    )).all()
    groups_detail = []
    for gid, gname in group_rows:
        gkeys = list((await db.execute(
            select(Permission.key)
            .join(PermissionGroupItem, PermissionGroupItem.permission_id == Permission.id)
            .where(PermissionGroupItem.group_id == gid)
        )).scalars().all())
        groups_detail.append({"id": gid, "name": gname, "permissions": gkeys})
        for k in gkeys:
            perm_sources.setdefault(k, []).append(f"group:{gname}")

    # 4) 현재 학기 직책 (PositionTemplate via EnrollmentPosition)
    from app.core.semester import get_current_semester
    import json as _json
    positions_detail = []
    sem = await get_current_semester(db)
    if sem:
        pos_rows = (await db.execute(
            select(
                PositionTemplate.id, PositionTemplate.key,
                PositionTemplate.display_name, PositionTemplate.permission_keys,
                SemesterEnrollment.semester_id,
            )
            .join(EnrollmentPosition, EnrollmentPosition.position_template_id == PositionTemplate.id)
            .join(SemesterEnrollment, SemesterEnrollment.id == EnrollmentPosition.enrollment_id)
            .where(
                SemesterEnrollment.semester_id == sem.id,
                SemesterEnrollment.user_id == user_id,
                SemesterEnrollment.status == "active",
            )
        )).all()
        for tid, tkey, tname, raw, sid in pos_rows:
            try:
                pkeys = _json.loads(raw or "[]")
            except (ValueError, TypeError):
                pkeys = []
            # 존재하는 키만 (직책 권한 해석과 동일한 정책)
            pkeys = [k for k in pkeys if k in effective]
            positions_detail.append({
                "template_id": tid, "key": tkey, "display_name": tname,
                "semester_id": sid, "semester_name": sem.name,
                "permissions": pkeys,
            })
            for k in pkeys:
                perm_sources.setdefault(k, []).append(f"position:{tname}")

    return {
        "user_id": user_id,
        "role": target.role,
        "effective_permissions": sorted(effective),
        "sources": {
            "role": role_keys,
            "user": user_keys,
            "groups": groups_detail,
            "positions": positions_detail,
        },
        "permission_sources": perm_sources,
        # 하위 호환 — 기존 응답 필드 유지
        "individual_permissions": user_keys,
        "permission_groups": [{"id": g["id"], "name": g["name"]} for g in groups_detail],
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
    2FA 필수.
    """
    await verify_2fa_session(user, request, db)
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
    await _invalidate_user_sessions(db, user_id)
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

    perms_changed = "permissions" in body
    if perms_changed:
        await db.execute(
            delete(PermissionGroupItem).where(PermissionGroupItem.group_id == group_id)
        )
        for key in body["permissions"]:
            perm_result = await db.execute(select(Permission).where(Permission.key == key))
            perm = perm_result.scalar_one_or_none()
            if perm:
                db.add(PermissionGroupItem(group_id=group_id, permission_id=perm.id))

    await db.flush()

    # 권한이 변경됐다면 이 그룹을 할당받은 모든 사용자 세션 무효화
    if perms_changed:
        member_uids = (await db.execute(
            select(UserPermissionGroup.user_id)
            .where(UserPermissionGroup.group_id == group_id)
        )).scalars().all()
        for uid in set(member_uids):
            await _invalidate_user_sessions(db, uid)
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


@router.get("/groups/{group_id}")
async def get_group_detail(
    group_id: int,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """그룹 상세 — 권한 키 + 할당된 사용자 목록."""
    group = (await db.execute(
        select(PermissionGroup).where(PermissionGroup.id == group_id)
    )).scalar_one_or_none()
    if not group:
        raise HTTPException(404)

    perm_keys = list((await db.execute(
        select(Permission.key)
        .join(PermissionGroupItem, PermissionGroupItem.permission_id == Permission.id)
        .where(PermissionGroupItem.group_id == group_id)
    )).scalars().all())

    member_rows = (await db.execute(
        select(User.id, User.name, User.email, User.role)
        .join(UserPermissionGroup, UserPermissionGroup.user_id == User.id)
        .where(UserPermissionGroup.group_id == group_id)
        .order_by(User.role, User.name)
    )).all()

    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "permissions": perm_keys,
        "members": [
            {"id": uid, "name": name, "email": email, "role": role}
            for uid, name, email, role in member_rows
        ],
    }


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
    await _invalidate_user_sessions(db, target_user_id)
    await db.flush()
    await log_action(db, user, "permission_group_assigned",
                     target=f"user:{target_user_id} group:{group_id}", request=request)
    return {"ok": True}


# 권한 변경 이력 (audit-history) endpoint는 permissions/audit.py로 분리.


@router.delete("/groups/{group_id}/members/{user_id}")
async def remove_group_member(
    group_id: int, user_id: int, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """그룹에서 사용자 제거 (UserPermissionGroup 행 삭제)."""
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자 없음")
    if user.role == "designated_admin" and target.role not in MANAGEABLE_ROLES_BY_DESIGNATED:
        raise HTTPException(403, "해당 사용자의 그룹을 변경할 수 없습니다")

    row = (await db.execute(
        select(UserPermissionGroup).where(
            UserPermissionGroup.user_id == user_id,
            UserPermissionGroup.group_id == group_id,
        )
    )).scalar_one_or_none()
    if not row:
        return {"ok": True, "message": "이미 그룹 멤버가 아님"}

    await db.delete(row)
    await db.flush()
    await _invalidate_user_sessions(db, user_id)
    await db.flush()
    await log_action(
        db, user, "permission_group_unassigned",
        target=f"user:{user_id} group:{group_id}", request=request,
    )
    return {"ok": True}


# ── 직책 권한 템플릿 헬퍼 ──
# endpoint들은 permissions/positions.py로 분리됨 (학기 권한 위임 도메인).
# 이 헬퍼들은 positions.py가 import해서 사용.

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

