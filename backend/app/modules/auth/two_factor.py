"""TOTP 기반 2FA endpoints — setup, confirm, verify, disable.

router 객체는 router.py에서 공유.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.totp import (
    create_totp_session,
    decrypt_secret,
    encrypt_secret,
    generate_qr_base64,
    generate_totp_secret,
    get_totp_uri,
    verify_totp_code,
)
from app.core.config import settings
from app.models.user import User
from app.modules.auth.schemas import (
    TwoFactorConfirmRequest,
    TwoFactorSetupResponse,
    TwoFactorVerifyRequest,
)

from app.modules.auth.router import router


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


