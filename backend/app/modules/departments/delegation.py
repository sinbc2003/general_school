"""부서장 권한 위임 — 부장교사가 계원(부서 소속 사용자)에게 권한 부여.

원칙:
  - 부장(Department.lead_user_id == user.id) 또는 super_admin/designated_admin만 위임 가능
  - 부서 소속 사용자(User.department_id == dept_id)에게만 위임 가능
  - 부장도 본인이 가진 권한만 위임 가능 (자기보다 강한 권한 부여 차단)
  - 위임은 UserPermission 행 추가 (기존 권한 시스템 재사용)
  - audit_log 모든 작업

엔드포인트:
  GET    /api/departments/{id}/members         — 부서 소속 사용자 list
  GET    /api/departments/{id}/delegations     — 위임된 권한 list (member × permission_key)
  POST   /api/departments/{id}/delegations     — 권한 부여
  DELETE /api/departments/{id}/delegations/{user_id}/{key} — 회수
"""

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission, resolve_permissions
from app.models import Department, User
from app.models.permission import Permission, UserPermission
from app.modules.departments.router import router


# 부장이 위임 못 하는 권한 (admin/system 전용 — 부장이 가지고 있더라도 위임 불가)
DELEGATION_BLOCKED_PREFIXES = (
    "system.",
    "permission.manage.",
    "user.manage.delete",
    "user.manage.create",
    "google.integration.configure",
    "department.manage",
)


class GrantPermission(BaseModel):
    user_id: int = Field(..., gt=0)
    permission_key: str = Field(..., min_length=1, max_length=100)


async def _is_lead_or_admin(db: AsyncSession, user: User, dept_id: int) -> bool:
    if user.role in ("super_admin", "designated_admin"):
        return True
    dept = await db.get(Department, dept_id)
    return bool(dept and dept.lead_user_id == user.id)


@router.get("/{dept_id}/available-permissions")
async def available_permissions_for_delegation(
    dept_id: int,
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    """부장이 위임할 수 있는 권한 목록.

    - admin: 차단된 prefix 제외한 모든 권한
    - 부장: 본인이 가진 권한 중 차단된 prefix 제외
    """
    if not await _is_lead_or_admin(db, user, dept_id):
        raise HTTPException(403, "부장 또는 관리자만 접근 가능")

    all_perms = (await db.execute(
        select(Permission).order_by(Permission.category, Permission.key)
    )).scalars().all()

    if user.role in ("super_admin", "designated_admin"):
        allowed_keys = {p.key for p in all_perms}
    else:
        allowed_keys = await resolve_permissions(db, user)

    items = []
    for p in all_perms:
        if p.key not in allowed_keys:
            continue
        if any(p.key.startswith(prefix) for prefix in DELEGATION_BLOCKED_PREFIXES):
            continue
        items.append({
            "key": p.key,
            "display_name": p.display_name,
            "category": p.category,
        })
    return {"items": items}


@router.get("/{dept_id}/members")
async def list_department_members(
    dept_id: int,
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    """부서 소속 사용자 목록 (User.department_id 매칭)."""
    dept = await db.get(Department, dept_id)
    if not dept:
        raise HTTPException(404, "부서 없음")
    members = (await db.execute(
        select(User).where(
            User.department_id == dept_id,
            User.status != "disabled",
        ).order_by(User.name)
    )).scalars().all()
    return {
        "department": {"id": dept.id, "name": dept.name, "lead_user_id": dept.lead_user_id},
        "items": [
            {
                "id": u.id, "name": u.name, "email": u.email,
                "role": u.role, "is_lead": u.id == dept.lead_user_id,
            }
            for u in members
        ],
    }


@router.get("/{dept_id}/delegations")
async def list_delegations(
    dept_id: int,
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    """부서 멤버에게 위임된 권한 list."""
    dept = await db.get(Department, dept_id)
    if not dept:
        raise HTTPException(404, "부서 없음")
    rows = (await db.execute(
        select(User, UserPermission, Permission)
        .join(UserPermission, UserPermission.user_id == User.id)
        .join(Permission, Permission.id == UserPermission.permission_id)
        .where(User.department_id == dept_id)
        .order_by(User.name, Permission.key)
    )).all()
    items = []
    for u, up, p in rows:
        items.append({
            "user_id": u.id,
            "user_name": u.name,
            "permission_key": p.key,
            "permission_display": p.display_name,
            "granted_at": up.created_at.isoformat() if up.created_at else None,
        })
    return {"items": items}


@router.post("/{dept_id}/delegations")
async def grant_delegation(
    dept_id: int,
    body: GrantPermission,
    request: Request,
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    """권한 부여. 부장 또는 admin만."""
    if not await _is_lead_or_admin(db, user, dept_id):
        raise HTTPException(403, "부장(부서장) 또는 관리자만 위임할 수 있습니다")

    # 위임 금지 권한 차단
    if any(body.permission_key.startswith(p) for p in DELEGATION_BLOCKED_PREFIXES):
        raise HTTPException(403, f"이 권한은 부서장이 위임할 수 없습니다: {body.permission_key}")

    # 부장이 본인 권한 안에서만 위임 가능 (admin은 무제한)
    if user.role not in ("super_admin", "designated_admin"):
        my_perms = await resolve_permissions(db, user)
        if body.permission_key not in my_perms:
            raise HTTPException(403, "본인이 보유한 권한만 위임할 수 있습니다")

    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(404, "대상 사용자 없음")
    if target.department_id != dept_id:
        raise HTTPException(400, "해당 부서 소속이 아닙니다")

    perm = (await db.execute(
        select(Permission).where(Permission.key == body.permission_key)
    )).scalar_one_or_none()
    if not perm:
        raise HTTPException(404, f"권한 키 없음: {body.permission_key}")

    # 중복 차단
    exists = (await db.execute(
        select(UserPermission).where(
            UserPermission.user_id == target.id,
            UserPermission.permission_id == perm.id,
        )
    )).scalar_one_or_none()
    if exists:
        return {"ok": True, "skipped": True}

    db.add(UserPermission(user_id=target.id, permission_id=perm.id, granted_by=user.id))
    await db.flush()
    # 위임 즉시 반영을 위해 대상 사용자의 세션 무효화 (다음 요청 시 token refresh)
    from app.modules.permissions.router import _invalidate_user_sessions
    await _invalidate_user_sessions(db, target.id)
    await db.flush()
    await log_action(
        db, user, "department_delegate",
        target=f"user:{target.id}",
        detail=f"dept={dept_id} key={body.permission_key}",
        request=request, is_sensitive=True,
    )
    return {"ok": True}


@router.delete("/{dept_id}/delegations/{user_id}/{permission_key}")
async def revoke_delegation(
    dept_id: int,
    user_id: int,
    permission_key: str,
    request: Request,
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    if not await _is_lead_or_admin(db, user, dept_id):
        raise HTTPException(403, "부장 또는 관리자만 회수할 수 있습니다")

    # 부장이 다른 부서 사용자의 권한을 회수할 수 없도록 부서 일치 확인 (admin은 예외)
    if user.role not in ("super_admin", "designated_admin"):
        target_u = await db.get(User, user_id)
        if not target_u or target_u.department_id != dept_id:
            raise HTTPException(403, "해당 부서 소속이 아닌 사용자입니다")

    perm = (await db.execute(
        select(Permission).where(Permission.key == permission_key)
    )).scalar_one_or_none()
    if not perm:
        raise HTTPException(404, "권한 키 없음")

    up = (await db.execute(
        select(UserPermission).where(
            UserPermission.user_id == user_id,
            UserPermission.permission_id == perm.id,
        )
    )).scalar_one_or_none()
    if up:
        await db.delete(up)
        await db.flush()
        # 즉시 반영을 위해 세션 무효화
        from app.modules.permissions.router import _invalidate_user_sessions
        await _invalidate_user_sessions(db, user_id)
        await db.flush()
    await log_action(
        db, user, "department_delegate_revoke",
        target=f"user:{user_id}",
        detail=f"dept={dept_id} key={permission_key}",
        request=request, is_sensitive=True,
    )
    return {"ok": True}
