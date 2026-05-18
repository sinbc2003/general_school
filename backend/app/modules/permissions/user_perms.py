"""개별 사용자 권한 endpoints — get + update (출처 추적 포함).

router 객체는 router.py에서 공유.
"""

import json

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_2fa_session
from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import (
    require_permission_manager,
    resolve_permissions,
    SUPER_ADMIN_ONLY_KEYS,
)
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

from app.modules.permissions.router import (
    router, MANAGEABLE_ROLES_BY_DESIGNATED, _invalidate_user_sessions,
)
from app.modules.permissions.schemas import UserPermissionsUpdate


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
    body: UserPermissionsUpdate,
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

    permission_keys = body.permissions

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


