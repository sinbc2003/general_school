"""인증 모듈 — 비밀번호 + JWT + 2FA(TOTP)"""

import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User, RefreshToken, TOTPSession

# ── 비밀번호 해싱 (직접 bcrypt 사용) ──
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT 토큰 ──
def create_access_token(user_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token_value() -> str:
    return secrets.token_urlsafe(64)


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "잘못된 토큰 타입")
        return payload
    except JWTError:
        raise HTTPException(401, "토큰이 유효하지 않거나 만료되었습니다")


# ── 현재 사용자 가져오기 ──
async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(401, "인증이 필요합니다")

    payload = decode_access_token(credentials.credentials)
    user_id = int(payload["sub"])

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(401, "사용자를 찾을 수 없습니다")
    if user.status == "disabled":
        raise HTTPException(403, "비활성화된 계정입니다")

    return user


# ── 역할 체크 ──
def require_role(*roles: str):
    """특정 역할만 접근 허용"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role == "super_admin":
            return user
        if user.role not in roles:
            raise HTTPException(403, f"접근 권한이 없습니다. 필요 역할: {', '.join(roles)}")
        return user
    return _check


# ── 2FA 세션 검증 ──
async def verify_2fa_session(
    user: User,
    request: Request,
    db: AsyncSession,
) -> bool:
    """2FA가 활성화된 사용자의 유효한 세션이 있는지 확인"""
    if not user.totp_enabled:
        return True  # 2FA 미설정 사용자는 통과

    client_ip = request.client.host if request.client else None
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(TOTPSession).where(
            TOTPSession.user_id == user.id,
            TOTPSession.expires_at > now,
            TOTPSession.ip_address == client_ip,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "2FA_REQUIRED",
                "message": "2차 인증이 필요합니다",
            },
        )
    return True
