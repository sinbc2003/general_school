"""세션 관리 + 비밀번호 리셋 endpoints.

- 대상 사용자의 refresh token 목록 조회 + 강제 로그아웃
- 비밀번호 리셋 (관리자가 default 비번으로 강제 변경, must_change_password=True)

router 객체는 router.py에서 공유. router.py 끝의 'from . import sessions'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import hash_password
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.user import User

from app.modules.users.router import router
from app.modules.users._helpers import ADMIN_ROLES, _is_admin


@router.get("/{user_id}/sessions")
async def list_user_sessions(
    user_id: int,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    """대상 사용자의 활성 refresh token 목록 (만료된 것 제외).
    super_admin/designated_admin만 조회 가능 (자기 자신은 별도 endpoint 권장).
    """
    from datetime import datetime as _dt, timezone as _tz
    from app.models.user import RefreshToken

    if not _is_admin(user):
        raise HTTPException(403, "다른 사용자 세션 조회는 관리자만 가능합니다")

    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if user.role == "designated_admin" and target.role in ADMIN_ROLES:
        raise HTTPException(403, "상위 관리자 세션은 조회할 수 없습니다")

    now = _dt.now(_tz.utc)
    rows = (await db.execute(
        select(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.expires_at > now)
        .order_by(RefreshToken.created_at.desc())
    )).scalars().all()
    return {
        "user_id": user_id,
        "user_name": target.name,
        "active_count": len(rows),
        "items": [
            {
                "id": r.id,
                # refresh token 평문 노출 금지 — 마지막 8자만 표시 (식별용)
                "token_preview": r.token[-8:] if r.token else "",
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            }
            for r in rows
        ],
    }


@router.delete("/{user_id}/sessions")
async def force_logout_user(
    user_id: int, request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """대상 사용자 모든 세션 강제 종료. 의심스러운 활동 즉시 차단용.
    next access token 만료(짧은 TTL) 이후 강제 재로그인.
    """
    if not _is_admin(user):
        raise HTTPException(403, "강제 로그아웃은 관리자만 가능합니다")
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.id == user.id:
        raise HTTPException(400, "본인 세션은 /auth/logout으로 종료하세요")
    if user.role == "designated_admin" and target.role in ADMIN_ROLES:
        raise HTTPException(403, "상위 관리자 강제 로그아웃은 불가합니다")

    from app.modules.permissions.router import _invalidate_user_sessions
    count = await _invalidate_user_sessions(db, user_id)
    await db.flush()
    await log_action(
        db, user, "user.force_logout",
        target=f"user:{user_id} email:{target.email} count:{count}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "invalidated": count}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404)

    # 타인 비번 리셋은 관리자만 (이중 방어). 본인 변경은 /auth/change-password 사용.
    if target.id != user.id and not _is_admin(user):
        raise HTTPException(403, "타인의 비밀번호 리셋은 관리자만 가능합니다")
    # 지정관리자가 상위 관리자 비번 리셋 차단
    if user.role == "designated_admin" and target.role in ADMIN_ROLES:
        raise HTTPException(403, "상위 관리자의 비밀번호를 리셋할 수 없습니다")

    target.password_hash = hash_password(settings.DEFAULT_USER_PASSWORD)
    target.must_change_password = True
    await db.flush()
    await log_action(db, user, "password_reset", target=target.email, request=request)
    return {"ok": True, "default_password": settings.DEFAULT_USER_PASSWORD}
