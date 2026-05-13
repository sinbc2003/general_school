"""감사 로그 헬퍼"""

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.user import User


async def log_action(
    db: AsyncSession,
    user: User,
    action: str,
    target: str | None = None,
    detail: str | None = None,
    request: Request | None = None,
    is_sensitive: bool = False,
) -> None:
    ip = None
    user_agent = None
    if request:
        ip = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent")

    entry = AuditLog(
        user_id=user.id,
        user_email=user.email,
        user_role=user.role,
        action=action,
        target=target,
        detail=detail,
        ip=ip,
        user_agent=user_agent,
        is_sensitive=is_sensitive,
    )
    db.add(entry)
    await db.flush()
