"""권한 그룹 endpoints — CRUD + 멤버 관리.

router 객체는 router.py에서 공유.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_2fa_session
from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_super_admin, require_permission_manager
from app.models.user import User
from app.models.permission import (
    Permission, PermissionGroup, PermissionGroupItem, UserPermissionGroup,
)

from app.modules.permissions.router import (
    router, MANAGEABLE_ROLES_BY_DESIGNATED, _invalidate_user_sessions,
)
from app.modules.permissions.schemas import (
    GroupAssignMember, GroupCreate, GroupUpdate,
)


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
    body: GroupCreate,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    group = PermissionGroup(
        name=body.name,
        description=body.description,
        created_by=user.id,
    )
    db.add(group)
    await db.flush()

    for key in body.permissions:
        perm_result = await db.execute(select(Permission).where(Permission.key == key))
        perm = perm_result.scalar_one_or_none()
        if perm:
            db.add(PermissionGroupItem(group_id=group.id, permission_id=perm.id))

    await db.flush()
    await log_action(db, user, "permission_group_created", target=body.name, request=request)
    return {"id": group.id, "name": group.name}


@router.put("/groups/{group_id}")
async def update_group(
    group_id: int,
    body: GroupUpdate,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PermissionGroup).where(PermissionGroup.id == group_id))
    group = result.scalar_one_or_none()
    if not group:
        raise HTTPException(404)

    patch = body.model_dump(exclude_unset=True)
    if "name" in patch:
        group.name = patch["name"]
    if "description" in patch:
        group.description = patch["description"]

    perms_changed = "permissions" in patch
    if perms_changed:
        await db.execute(
            delete(PermissionGroupItem).where(PermissionGroupItem.group_id == group_id)
        )
        for key in patch["permissions"] or []:
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
    body: GroupAssignMember,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """권한 그룹을 사용자에게 할당."""
    target_user_id = body.user_id

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

