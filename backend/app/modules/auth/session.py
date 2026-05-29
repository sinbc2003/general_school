"""세션/계정 endpoints — refresh, logout, /me, change-password, password-policy.

router 객체는 router.py에서 공유. router.py 끝의 'from . import session'으로 등록.
"""

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import (
    create_access_token, create_refresh_token_value,
    get_current_user, hash_password, verify_password,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import resolve_permissions
from app.models.user import RefreshToken, User
from app.modules.auth.schemas import (
    ChangePasswordRequest, RefreshRequest, TokenResponse,
)

from app.modules.auth.router import router
from app.modules.auth._helpers import _check_must_enable_2fa, _user_to_dict


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == body.refresh_token)
    )
    token_row = result.scalar_one_or_none()

    # SQLite는 timezone 정보를 저장하지 않아서 expires_at이 naive로 돌아올 수 있음.
    # 저장 시 UTC였으므로 UTC tzinfo 부여 후 비교.
    expires_at = token_row.expires_at if token_row else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not token_row or (expires_at and expires_at < datetime.now(timezone.utc)):
        raise HTTPException(401, "리프레시 토큰이 유효하지 않습니다")

    result = await db.execute(select(User).where(User.id == token_row.user_id))
    user = result.scalar_one_or_none()

    if not user or user.status == "disabled":
        raise HTTPException(403, "계정 접근이 불가합니다")

    # 기존 토큰 삭제 + 새 토큰 발급 (rotation)
    await db.delete(token_row)

    access_token = create_access_token(user.id, user.role)
    new_refresh = create_refresh_token_value()
    db.add(RefreshToken(
        user_id=user.id,
        token=new_refresh,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await db.flush()

    perms = await resolve_permissions(db, user)
    must_2fa = await _check_must_enable_2fa(user, db)

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        user=_user_to_dict(user, perms, must_enable_2fa=must_2fa),
    )


@router.post("/logout")
async def logout(
    body: RefreshRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == body.refresh_token,
            RefreshToken.user_id == user.id,
        )
    )
    token_row = result.scalar_one_or_none()
    if token_row:
        await db.delete(token_row)
    return {"ok": True}


@router.get("/me")
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.core.features import get_effective_features
    perms = await resolve_permissions(db, user)
    must_2fa = await _check_must_enable_2fa(user, db)
    features = await get_effective_features(db, user)
    out = _user_to_dict(user, perms, must_enable_2fa=must_2fa)
    out["features"] = features
    return out


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "현재 비밀번호가 잘못되었습니다")

    from app.core.password_policy import validate_password
    try:
        await validate_password(db, body.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.flush()

    await log_action(db, user, "password_changed", request=request)
    return {"ok": True}


# ── 비밀번호 정책 공개 조회 (로그인 페이지·강제 변경 페이지에서 안내용) ──
@router.get("/password-policy")
async def get_password_policy_endpoint(db: AsyncSession = Depends(get_db)):
    """현재 비밀번호 정책 요약. 인증 불필요 — 로그인/변경 페이지에 안내."""
    from app.core.password_policy import describe_policy
    return await describe_policy(db)
