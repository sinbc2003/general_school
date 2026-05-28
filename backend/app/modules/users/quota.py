"""사용자 quota 관리 endpoints — super_admin 전용.

- POST /api/users/{user_id}/quota — 개별 사용자 quota 변경 (MB)
- POST /api/users/_quota/bulk — 역할별 일괄 변경

설계:
  - 권한: user.manage.quota (super_admin/designated_admin이 부여 가능)
  - super_admin의 quota는 항상 0 (무제한 sentinel) — 다른 값 지정 차단
  - 0 = 무제한 sentinel (super_admin 외 사용자에게도 부여 가능 — 무제한 교사 등)
  - 음수 거부
  - used_bytes 초과하는 값으로 줄여도 OK (이미 쓴 만큼은 그대로 = quota 초과 상태)
  - audit log 필수 (민감)
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.user import User
from app.modules.users.router import router
from app.modules.users.schemas import QuotaBulkUpdate, QuotaUpdate


VALID_ROLES_FOR_BULK = {"designated_admin", "teacher", "staff", "student"}


def _mb_to_bytes(mb: int) -> int:
    return max(0, int(mb)) * 1024 * 1024


@router.post("/_quota/bulk")
async def bulk_update_quota_by_role(
    body: QuotaBulkUpdate,
    request: Request,
    user: User = Depends(require_permission("user.manage.quota")),
    db: AsyncSession = Depends(get_db),
):
    """역할별 일괄 quota 변경.

    예: {"role": "teacher", "quota_mb": 1024} → 모든 teacher의 quota_bytes = 1GB.
    super_admin role은 일괄 변경 차단 (무제한 유지).
    """
    if body.role not in VALID_ROLES_FOR_BULK:
        raise HTTPException(
            400,
            f"일괄 변경 가능한 역할: {sorted(VALID_ROLES_FOR_BULK)} — super_admin은 항상 무제한",
        )
    if body.quota_mb < 0:
        raise HTTPException(400, "quota_mb는 0 이상이어야 합니다 (0 = 무제한)")

    bytes_val = _mb_to_bytes(body.quota_mb)

    # 영향 받는 사용자 수 미리 카운트 (audit detail용)
    affected = (await db.execute(
        select(User.id).where(User.role == body.role)
    )).scalars().all()
    count = len(affected)

    await db.execute(
        update(User).where(User.role == body.role).values(quota_bytes=bytes_val)
    )
    await db.flush()

    await log_action(
        db, user, "user_quota_bulk_update",
        target=f"role:{body.role}",
        detail=f"quota_mb={body.quota_mb} affected={count}",
        request=request,
        is_sensitive=True,
    )
    return {
        "ok": True,
        "role": body.role,
        "quota_mb": body.quota_mb,
        "quota_bytes": bytes_val,
        "affected_count": count,
    }


@router.post("/{user_id}/quota")
async def update_user_quota(
    user_id: int,
    body: QuotaUpdate,
    request: Request,
    user: User = Depends(require_permission("user.manage.quota")),
    db: AsyncSession = Depends(get_db),
):
    """개별 사용자 quota 변경.

    - body.quota_mb=0 → 무제한
    - super_admin 대상자는 무제한 유지 — 다른 값 거부
    - 줄여서 used_bytes 초과 상태가 돼도 허용 (이후 업로드만 막힘, 기존 자료는 안 지움)
    """
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    if body.quota_mb < 0:
        raise HTTPException(400, "quota_mb는 0 이상이어야 합니다 (0 = 무제한)")

    if target.role == "super_admin" and body.quota_mb != 0:
        raise HTTPException(
            400, "최고관리자는 항상 무제한 (quota_mb=0)으로 유지됩니다",
        )

    # 지정관리자는 super_admin quota 변경 불가 (요구 권한 자체는 통과해도 정책상 차단)
    if user.role == "designated_admin" and target.role == "super_admin":
        raise HTTPException(403, "최고관리자의 용량은 변경할 수 없습니다")

    old_mb = (target.quota_bytes or 0) // 1024 // 1024
    new_bytes = _mb_to_bytes(body.quota_mb)
    target.quota_bytes = new_bytes
    await db.flush()

    await log_action(
        db, user, "user_quota_update",
        target=target.email,
        detail=f"{old_mb}MB -> {body.quota_mb}MB",
        request=request,
        is_sensitive=True,
    )
    return {
        "ok": True,
        "user_id": user_id,
        "email": target.email,
        "quota_bytes": new_bytes,
        "quota_mb": body.quota_mb,
        "used_bytes": target.used_bytes or 0,
    }
