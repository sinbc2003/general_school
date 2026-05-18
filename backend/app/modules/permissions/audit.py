"""권한 변경 이력 timeline endpoint.

audit_log 전체에서 권한 관련 action만 필터링해 timeline 형식으로 제공.
프론트엔드 /permissions '변경 이력' 탭이 호출.
"""

from datetime import datetime, timedelta

from fastapi import Depends
from sqlalchemy import select, desc, func as sa_func, or_ as sa_or
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission_manager
from app.models.audit import AuditLog
from app.models.user import User

from app.modules.permissions.router import router


# 권한 관련 action 화이트리스트 — UI 필터링 기준.
# 새 권한 관련 action 추가 시 여기 등록 (예: backup, device, semester).
PERMISSION_AUDIT_ACTIONS = [
    # 사용자 자체
    "user_created", "user_updated", "user_disabled", "user.force_logout",
    "password_reset", "password_changed",
    # 권한 직접 부여
    "user_permissions_updated", "role_permissions_updated",
    # 권한 그룹
    "permission_group_created", "permission_group_updated",
    "permission_group_deleted", "permission_group_assigned",
    "permission_group_unassigned",
    # 학기 직책
    "position_template.create", "position_template.update", "position_template.delete",
    "position_template.apply_to_department",
    "enrollment_position.set", "enrollment_position.sync_year",
    # 정책
    "policy.designated_admin_mode", "policy.admin_2fa_required", "policy.password",
    # 인증/2FA
    "login", "login.email_challenge_sent", "login.email_challenge_resent",
    "2fa_enabled", "2fa_verified", "2fa_disabled",
    "device.trusted_added", "device.trusted_revoked", "device.trusted_revoked_all",
    # 학기 라이프사이클
    "semester.create", "semester.archive", "semester.unarchive",
    "enrollment.add", "enrollment.update", "enrollment.delete",
]


@router.get("/audit-history")
async def get_permission_audit_history(
    user_id: int | None = None,
    actor_email: str | None = None,
    action_filter: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    per_page: int = 50,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """권한 관련 audit log timeline. 권한·역할·세션·정책·인증 이벤트만.

    필터:
      - user_id: 특정 사용자에 영향을 준 로그 (target에 user_id 또는 email 포함)
      - actor_email: 변경을 가한 사람 (user_email 매칭)
      - action_filter: action에 포함되는 키워드
      - date_from / date_to: ISO 날짜
    """
    query = select(AuditLog).where(AuditLog.action.in_(PERMISSION_AUDIT_ACTIONS))

    if action_filter:
        query = query.where(AuditLog.action.ilike(f"%{action_filter}%"))
    if actor_email:
        query = query.where(AuditLog.user_email.ilike(f"%{actor_email}%"))
    if user_id:
        # target에 user_id 또는 email 매칭
        target_user = (await db.execute(
            select(User).where(User.id == user_id)
        )).scalar_one_or_none()
        patterns = [f"%user:{user_id}%", f"%user_id:{user_id}%", f"{user_id}"]
        if target_user:
            patterns.append(f"%{target_user.email}%")
        query = query.where(sa_or(*(AuditLog.target.ilike(p) for p in patterns)))
    if date_from:
        try:
            query = query.where(AuditLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            query = query.where(AuditLog.timestamp < end)
        except ValueError:
            pass

    # 총 개수
    count_q = select(sa_func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # 정렬 + 페이징
    query = query.order_by(desc(AuditLog.timestamp))
    query = query.offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(query)).scalars().all()

    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "items": [
            {
                "id": r.id,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "user_email": r.user_email,
                "user_role": r.user_role,
                "action": r.action,
                "target": r.target,
                "detail": r.detail,
                "ip": r.ip,
                "is_sensitive": r.is_sensitive,
            }
            for r in rows
        ],
    }
