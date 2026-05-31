"""이메일 코드 기반 2FA 단계 인증(step-up).

인증앱(TOTP) 대신 **이메일로 받은 6자리 코드**로 민감데이터 접근 세션을 발급한다.
로그인 2FA 인프라(LoginChallenge + send_login_code + create_totp_session)를 그대로 재사용하므로
추가 비용(SMS 등)·앱 설치가 필요 없다.

endpoints (router prefix /api/auth):
  POST /2fa/email/send    — 본인 이메일로 코드 발송, challenge_token 반환
  POST /2fa/email/verify  — challenge_token + code 검증 → 민감데이터 세션(TOTPSession) 생성

router 객체는 router.py에서 공유. router.py 끝의 'from . import two_factor_email'로 등록.
"""

from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user, hash_password, verify_password
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_login_code
from app.core.totp import create_totp_session
from app.models.device import (
    LoginChallenge,
    generate_challenge_token,
    generate_verification_code,
)
from app.models.user import User
from app.modules.auth.router import router


def _mask_email(email: str) -> str:
    try:
        local, domain = email.split("@", 1)
        head = local[:2] if len(local) > 2 else local[:1]
        return f"{head}***@{domain}"
    except ValueError:
        return "***"


class Email2FAVerifyRequest(BaseModel):
    challenge_token: str
    code: str


@router.post("/2fa/email/send")
async def send_email_2fa(
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """민감데이터 접근용 인증코드를 본인 이메일로 발송."""
    code = generate_verification_code()
    challenge_token = generate_challenge_token()
    db.add(LoginChallenge(
        challenge_token=challenge_token,
        user_id=user.id,
        code_hash=hash_password(code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.LOGIN_CHALLENGE_MINUTES),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent", "")[:500],
    ))
    await db.flush()
    await log_action(db, user, "2fa.email_code_sent", request=request, is_sensitive=True)

    ip = request.client.host if request.client else None
    background.add_task(send_login_code, user.email, user.name, code, ip)

    resp: dict = {
        "challenge_token": challenge_token,
        "email_masked": _mask_email(user.email),
        "expires_in_minutes": settings.LOGIN_CHALLENGE_MINUTES,
    }
    # dev 편의 (운영에서는 절대 노출 안 됨 — login_flow와 동일 가드)
    if settings.ENV == "dev" and not settings.SMTP_HOST:
        resp["dev_code"] = code
    return resp


@router.post("/2fa/email/verify")
async def verify_email_2fa(
    body: Email2FAVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """이메일 코드 검증 → 민감데이터 세션(TOTPSession) 발급. TOTP 세션과 동일하게 동작."""
    ch = (await db.execute(
        select(LoginChallenge).where(
            LoginChallenge.challenge_token == body.challenge_token,
            LoginChallenge.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not ch:
        raise HTTPException(400, "유효하지 않은 인증 요청입니다 (코드를 다시 요청하세요)")

    now = datetime.now(timezone.utc)
    expires_at = ch.expires_at if ch.expires_at.tzinfo else ch.expires_at.replace(tzinfo=timezone.utc)
    if ch.consumed or expires_at < now:
        raise HTTPException(400, "코드가 만료되었거나 이미 사용되었습니다")
    if ch.attempts >= settings.LOGIN_CHALLENGE_MAX_ATTEMPTS:
        raise HTTPException(429, "시도 횟수 초과 — 코드를 다시 요청하세요")

    ch.attempts += 1
    code = (body.code or "").strip().replace(" ", "")
    if not verify_password(code, ch.code_hash):
        await db.flush()
        remaining = settings.LOGIN_CHALLENGE_MAX_ATTEMPTS - ch.attempts
        raise HTTPException(400, f"코드가 일치하지 않습니다 (남은 시도 {remaining}회)")

    ch.consumed = True
    ip = request.client.host if request.client else None
    await create_totp_session(db, user.id, ip)
    await log_action(db, user, "2fa.email_verified", request=request, is_sensitive=True)
    return {"ok": True, "valid_minutes": settings.TOTP_SESSION_MINUTES}
