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


# ── 지정관리자 모드 정책 (super_admin only) ──

@router.get("/policy/designated-admin-mode")
async def get_designated_admin_mode_endpoint(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """현재 지정관리자 모드 조회."""
    from app.core.permissions import (
        get_designated_admin_mode,
        VALID_DESIGNATED_ADMIN_MODES,
    )
    return {
        "mode": await get_designated_admin_mode(db),
        "options": [
            {
                "value": "full",
                "label": "전체 권한 (디폴트)",
                "description": "지정관리자는 최고관리자 전용 권한을 제외한 모든 권한 자동 보유.",
            },
            {
                "value": "scoped",
                "label": "세분화 (매트릭스 토글)",
                "description": "지정관리자도 일반 역할처럼 매트릭스에서 명시 부여한 권한만 보유.",
            },
        ],
        "valid": sorted(VALID_DESIGNATED_ADMIN_MODES),
    }


@router.put("/policy/designated-admin-mode")
async def set_designated_admin_mode_endpoint(
    body: dict, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """지정관리자 모드 변경. 'full' ↔ 'scoped'.

    모드 변경 시 모든 designated_admin 사용자의 세션 무효화 (권한 셋이 달라짐).
    2FA 필수 (정책 변경은 영향력 큼).
    """
    from app.core.permissions import (
        set_designated_admin_mode,
        VALID_DESIGNATED_ADMIN_MODES,
    )
    await verify_2fa_session(user, request, db)

    mode = (body.get("mode") or "").strip()
    if mode not in VALID_DESIGNATED_ADMIN_MODES:
        raise HTTPException(400, f"mode must be one of {sorted(VALID_DESIGNATED_ADMIN_MODES)}")

    await set_designated_admin_mode(db, mode)
    invalidated = await _invalidate_role_sessions(db, "designated_admin")
    await db.flush()
    await log_action(
        db, user, "policy.designated_admin_mode",
        target=f"mode:{mode} sessions_invalidated:{invalidated}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "mode": mode, "sessions_invalidated": invalidated}


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
    2FA 필수 (권한 정의는 영향력 큼).
    """
    await verify_2fa_session(user, request, db)
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
    """직책 템플릿 수정 (key는 변경 불가 — enrollment 매핑 안전성). 2FA 필수."""
    await verify_2fa_session(user, request, db)
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
    keys_changed = "permission_keys" in body
    if keys_changed:
        perm_keys = await _validate_permission_keys(db, body["permission_keys"], user)
        p.permission_keys = json.dumps(perm_keys, ensure_ascii=False)

    await db.flush()

    # permission_keys가 바뀌면 이 직책을 부여받은 모든 enrollment의 사용자 세션 무효화
    if keys_changed:
        member_uids = (await db.execute(
            select(SemesterEnrollment.user_id)
            .join(EnrollmentPosition, EnrollmentPosition.enrollment_id == SemesterEnrollment.id)
            .where(EnrollmentPosition.position_template_id == tid)
        )).scalars().all()
        for uid in set(member_uids):
            await _invalidate_user_sessions(db, uid)
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
    """직책 템플릿 삭제. 시스템 기본은 삭제 불가. 2FA 필수.

    cascade=CASCADE로 enrollment_positions의 매핑 행도 자동 정리.
    """
    await verify_2fa_session(user, request, db)
    p = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    if p.is_system:
        raise HTTPException(403, "시스템 기본 템플릿은 삭제할 수 없습니다")

    # 삭제 전 영향받을 user_id 수집 (cascade로 EnrollmentPosition 함께 사라짐)
    affected_uids = (await db.execute(
        select(SemesterEnrollment.user_id)
        .join(EnrollmentPosition, EnrollmentPosition.enrollment_id == SemesterEnrollment.id)
        .where(EnrollmentPosition.position_template_id == tid)
    )).scalars().all()

    await db.delete(p)
    await db.flush()

    for uid in set(affected_uids):
        await _invalidate_user_sessions(db, uid)
    await db.flush()

    await log_action(
        db, user, "position_template.delete",
        target=f"id:{tid} key:{p.key} affected:{len(set(affected_uids))}", request=request,
    )
    return {"ok": True}


@router.post("/position-templates/{tid}/apply-to-department")
async def apply_position_template_to_department(
    tid: int, body: dict, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿을 특정 학기·부서의 모든 교직원 enrollment에 일괄 할당.

    body: {
      "semester_id": int,
      "department": str,                # SemesterEnrollment.department 매칭값
      "include_roles": ["teacher"|"staff"]?,  # 기본 ["teacher","staff"]
      "replace": bool = false           # True면 대상 enrollment의 기존 직책 통째로 교체
    }

    학년도 단위 운영 시나리오에서 "수학과 전체에 동일 권한" 같은 패턴을 빠르게.
    archived 학기는 차단.
    2FA 필수 (영향 범위 큼).
    """
    from sqlalchemy import delete as sql_delete
    await verify_2fa_session(user, request, db)

    template = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not template:
        raise HTTPException(404, "직책 템플릿 없음")

    semester_id = body.get("semester_id")
    department = (body.get("department") or "").strip()
    if not semester_id or not department:
        raise HTTPException(400, "semester_id, department 필수")

    # archived 학기 차단
    from app.models.timetable import Semester
    sem = (await db.execute(
        select(Semester).where(Semester.id == int(semester_id))
    )).scalar_one_or_none()
    if not sem:
        raise HTTPException(404, "학기 없음")
    if sem.is_archived:
        raise HTTPException(423, f"학기 '{sem.name}'은(는) 보관 상태입니다")

    include_roles = body.get("include_roles") or ["teacher", "staff"]
    replace = bool(body.get("replace", False))

    # 대상 enrollment 조회
    target_enrolls = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == int(semester_id),
            SemesterEnrollment.department == department,
            SemesterEnrollment.role.in_(include_roles),
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    if not target_enrolls:
        return {
            "ok": True, "applied": 0, "skipped": 0,
            "message": f"부서 '{department}'에 해당하는 active enrollment 없음",
        }

    applied = 0
    skipped = 0
    affected_uids: set[int] = set()
    for e in target_enrolls:
        if replace:
            # 기존 직책 모두 삭제 후 새로 추가
            await db.execute(
                sql_delete(EnrollmentPosition).where(EnrollmentPosition.enrollment_id == e.id)
            )
            db.add(EnrollmentPosition(
                enrollment_id=e.id, position_template_id=tid, granted_by=user.id,
            ))
            applied += 1
            affected_uids.add(e.user_id)
        else:
            # 이미 이 직책이 할당된 enrollment는 skip
            already = (await db.execute(
                select(EnrollmentPosition).where(
                    EnrollmentPosition.enrollment_id == e.id,
                    EnrollmentPosition.position_template_id == tid,
                )
            )).scalar_one_or_none()
            if already:
                skipped += 1
                continue
            db.add(EnrollmentPosition(
                enrollment_id=e.id, position_template_id=tid, granted_by=user.id,
            ))
            applied += 1
            affected_uids.add(e.user_id)

    await db.flush()

    # 영향받은 사용자 세션 무효화
    for uid in affected_uids:
        await _invalidate_user_sessions(db, uid)
    await db.flush()

    await log_action(
        db, user, "position_template.apply_to_department",
        target=f"tid:{tid} sem:{semester_id} dept:{department} applied:{applied} replace:{replace}",
        request=request, is_sensitive=True,
    )
    return {
        "ok": True,
        "applied": applied,
        "skipped": skipped,
        "affected_users": len(affected_uids),
    }
