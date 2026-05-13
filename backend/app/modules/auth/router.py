"""인증 라우터 — 로그인, 토큰 갱신, 2FA, 비밀번호 변경"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token_value,
    get_current_user,
)
from app.core.totp import (
    generate_totp_secret,
    get_totp_uri,
    generate_qr_base64,
    verify_totp_code,
    encrypt_secret,
    decrypt_secret,
    create_totp_session,
)
from app.core.audit import log_action
from app.core.permissions import resolve_permissions
from app.models.user import User, RefreshToken
from app.modules.auth.schemas import (
    LoginRequest,
    TokenResponse,
    RefreshRequest,
    TwoFactorSetupResponse,
    TwoFactorConfirmRequest,
    TwoFactorVerifyRequest,
    ChangePasswordRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_to_dict(user: User, permissions: set[str] | None = None) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "status": user.status,
        "grade": user.grade,
        "class_number": user.class_number,
        "student_number": user.student_number,
        "department": user.department,
        "totp_enabled": user.totp_enabled,
        "must_change_password": user.must_change_password,
        "permissions": list(permissions) if permissions else [],
    }


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # email 또는 username으로 사용자 검색
    result = await db.execute(
        select(User).where(
            or_(User.email == body.identifier, User.username == body.identifier)
        )
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "이메일/아이디 또는 비밀번호가 잘못되었습니다")

    if user.status == "disabled":
        raise HTTPException(403, "비활성화된 계정입니다")

    # 토큰 발급
    access_token = create_access_token(user.id, user.role)
    refresh_value = create_refresh_token_value()

    refresh_token = RefreshToken(
        user_id=user.id,
        token=refresh_value,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(refresh_token)

    user.last_login = datetime.now(timezone.utc)
    await db.flush()

    await log_action(db, user, "login", request=request)

    perms = await resolve_permissions(db, user)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_value,
        user=_user_to_dict(user, perms),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == body.refresh_token)
    )
    token_row = result.scalar_one_or_none()

    if not token_row or token_row.expires_at < datetime.now(timezone.utc):
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

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        user=_user_to_dict(user, perms),
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
    perms = await resolve_permissions(db, user)
    return _user_to_dict(user, perms)


# ── 2FA ──
@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def setup_2fa(user: User = Depends(get_current_user)):
    if user.totp_enabled:
        raise HTTPException(400, "2FA가 이미 활성화되어 있습니다")

    secret = generate_totp_secret()
    uri = get_totp_uri(secret, user.email)
    qr = generate_qr_base64(uri)

    return TwoFactorSetupResponse(secret=secret, qr_code=qr, uri=uri)


@router.post("/2fa/confirm")
async def confirm_2fa(
    body: TwoFactorConfirmRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 클라이언트가 setup에서 받은 secret을 헤더로 보내거나 세션에서 관리
    # 간단하게: X-TOTP-Secret 헤더로 전달
    secret = request.headers.get("X-TOTP-Secret")
    if not secret:
        raise HTTPException(400, "X-TOTP-Secret 헤더가 필요합니다")

    if not verify_totp_code(secret, body.code):
        raise HTTPException(400, "잘못된 인증 코드입니다")

    user.totp_secret = encrypt_secret(secret)
    user.totp_enabled = True
    await db.flush()

    await log_action(db, user, "2fa_enabled", request=request)
    return {"ok": True, "message": "2FA가 활성화되었습니다"}


@router.post("/2fa/verify")
async def verify_2fa(
    body: TwoFactorVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(400, "2FA가 설정되지 않았습니다")

    secret = decrypt_secret(user.totp_secret)
    if not verify_totp_code(secret, body.code):
        raise HTTPException(400, "잘못된 인증 코드입니다")

    ip = request.client.host if request.client else None
    await create_totp_session(db, user.id, ip)

    await log_action(db, user, "2fa_verified", request=request, is_sensitive=True)
    return {"ok": True, "message": "2차 인증 완료", "valid_minutes": settings.TOTP_SESSION_MINUTES}


@router.post("/2fa/disable")
async def disable_2fa(
    body: TwoFactorVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.totp_enabled or not user.totp_secret:
        raise HTTPException(400, "2FA가 설정되지 않았습니다")

    secret = decrypt_secret(user.totp_secret)
    if not verify_totp_code(secret, body.code):
        raise HTTPException(400, "잘못된 인증 코드입니다")

    user.totp_secret = None
    user.totp_enabled = False
    await db.flush()

    await log_action(db, user, "2fa_disabled", request=request)
    return {"ok": True}


# ── 비밀번호 변경 ──
@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "현재 비밀번호가 잘못되었습니다")

    if len(body.new_password) < 8:
        raise HTTPException(400, "새 비밀번호는 8자 이상이어야 합니다")

    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.flush()

    await log_action(db, user, "password_changed", request=request)
    return {"ok": True}
