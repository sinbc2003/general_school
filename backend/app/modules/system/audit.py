"""감사 로그 조회 + 보관 정책 관리.

router 객체는 router.py에서 공유. router.py 끝의 'from . import audit'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import verify_2fa_session
from app.core.database import get_db
from app.core.permissions import require_permission, require_super_admin
from app.models.audit import AuditLog
from app.models.user import User
from app.modules.system.schemas import AuditRetentionUpdate

from app.modules.system.router import router


@router.get("/audit-logs")
async def get_audit_logs(
    page: int = 1,
    per_page: int = 50,
    action: str | None = None,
    date_from: str | None = None,      # ISO 8601 (예: "2026-05-01")
    date_to: str | None = None,
    sensitive_only: bool = False,
    user_email: str | None = None,
    user: User = Depends(require_permission("system.audit.view")),
    db: AsyncSession = Depends(get_db),
):
    """감사 로그 조회. 필터: action 부분일치, 날짜 범위, sensitive only, user_email 부분일치."""
    from datetime import datetime
    query = select(AuditLog)
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if user_email:
        query = query.where(AuditLog.user_email.ilike(f"%{user_email}%"))
    if sensitive_only:
        query = query.where(AuditLog.is_sensitive == True)
    if date_from:
        try:
            query = query.where(AuditLog.timestamp >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            # date_to 끝까지 포함
            end = datetime.fromisoformat(date_to)
            from datetime import timedelta
            query = query.where(AuditLog.timestamp < end + timedelta(days=1))
        except ValueError:
            pass

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(desc(AuditLog.timestamp))
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "user_email": log.user_email,
                "user_role": log.user_role,
                "action": log.action,
                "target": log.target,
                "detail": log.detail,
                "ip": log.ip,
                "is_sensitive": log.is_sensitive,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
    }


# ── audit_log retention ──

@router.get("/audit/retention")
async def get_audit_retention(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """audit_log 보관 정책 조회 + 최근 cleanup 상태."""
    from app.core.audit_retention import get_retention_config
    return await get_retention_config(db)


@router.put("/audit/retention")
async def set_audit_retention(
    body: AuditRetentionUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """audit_log 보관 정책 변경 (부분 업데이트). 2FA 필수."""
    from app.core.audit_retention import set_retention_config
    await verify_2fa_session(user, request, db)
    patch = body.model_dump(exclude_unset=True)
    try:
        result = await set_retention_config(db, patch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await log_action(
        db, user, "audit.retention.update",
        target=f"updated:{sorted(patch.keys())}", request=request, is_sensitive=True,
    )
    return result


@router.post("/audit/retention/cleanup")
async def trigger_audit_cleanup(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """수동으로 retention 정책에 따라 즉시 정리. 2FA 필수."""
    from app.core.audit_retention import cleanup_audit_logs
    await verify_2fa_session(user, request, db)
    result = await cleanup_audit_logs(db)
    await log_action(
        db, user, "audit.retention.cleanup",
        target=f"total:{result['total']}", request=request, is_sensitive=True,
    )
    return result
