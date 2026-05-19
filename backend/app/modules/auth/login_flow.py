"""로그인 흐름 endpoints — login + 이메일 2FA 검증·재발송.

응답 분기:
- 학생: 즉시 토큰 발급
- 교직원 + 신뢰 장치 쿠키 매칭: 즉시 토큰 발급
- 교직원 + 신뢰 장치 없음: 이메일 코드 발송 + challenge_token 반환

router 객체는 router.py에서 공유. router.py 끝의 'from . import login_flow'로 등록.
"""

from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import (
    create_access_token, create_refresh_token_value, hash_password, verify_password,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.email import send_login_code
from app.core.permissions import resolve_permissions
from app.core.ratelimit import login_rate_limit, reset_login_rate
from app.models.device import (
    LoginChallenge, TrustedDevice,
    generate_challenge_token, generate_device_token, generate_verification_code,
)
from app.models.user import RefreshToken, User
from app.modules.auth.schemas import (
    LoginRequest, ResendEmailCodeRequest, TokenResponse, VerifyEmailCodeRequest,
)

from app.modules.auth.router import router
from app.modules.auth._helpers import _check_must_enable_2fa, _user_to_dict


def _mask_email(email: str) -> str:
    """이메일 마스킹 — 'john.doe@example.com' → 'jo***@example.com'."""
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def _device_token_prefix(token: str) -> str:
    """token에서 인덱스용 prefix 추출 — 첫 12자."""
    return (token or "")[:12]


async def _find_trusted_device(
    db: AsyncSession, user_id: int, device_token: str | None,
) -> TrustedDevice | None:
    """device cookie를 hash 비교하여 일치하고 만료 안 된 신뢰 장치 반환.

    성능: token_prefix 인덱스로 후보 1~few개로 좁힌 후 bcrypt 검증.
    이전 O(N) → 사실상 O(1). 사용자가 수십 장치 등록해도 빠름.
    """
    if not device_token:
        return None
    prefix = _device_token_prefix(device_token)
    # prefix가 있는 경우 인덱스 lookup
    if prefix:
        rows = (await db.execute(
            select(TrustedDevice).where(
                TrustedDevice.user_id == user_id,
                TrustedDevice.expires_at > datetime.now(timezone.utc),
                TrustedDevice.token_prefix == prefix,
            )
        )).scalars().all()
        for d in rows:
            if verify_password(device_token, d.token_hash):
                return d
    # fallback: prefix 없는 legacy 행 (마이그레이션 직후) — 향후 cleanup task로 제거.
    legacy_rows = (await db.execute(
        select(TrustedDevice).where(
            TrustedDevice.user_id == user_id,
            TrustedDevice.expires_at > datetime.now(timezone.utc),
            TrustedDevice.token_prefix.is_(None),
        )
    )).scalars().all()
    for d in legacy_rows:
        if verify_password(device_token, d.token_hash):
            # 매칭된 legacy 행에 prefix 백필
            d.token_prefix = prefix
            return d
    return None


async def _issue_tokens(
    db: AsyncSession, user: User, request: Request,
) -> TokenResponse:
    """access + refresh token 발급 + last_login 갱신. login·verify-email 공통."""
    access_token = create_access_token(user.id, user.role)
    refresh_value = create_refresh_token_value()

    db.add(RefreshToken(
        user_id=user.id,
        token=refresh_value,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    user.last_login = datetime.now(timezone.utc)
    await db.flush()
    await log_action(db, user, "login", request=request)

    perms = await resolve_permissions(db, user)
    must_2fa = await _check_must_enable_2fa(user, db)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_value,
        user=_user_to_dict(user, perms, must_enable_2fa=must_2fa),
    )


async def _start_email_challenge(
    db: AsyncSession, user: User, request: Request,
    background: BackgroundTasks | None = None,
) -> dict:
    """이메일 2FA 챌린지 시작 — 6자리 코드 생성·해시 저장·이메일 발송.

    이메일 발송은 BackgroundTasks로 비동기 (응답 지연 차단). 발송 실패는
    재발송 endpoint로 회복 가능.
    """
    code = generate_verification_code()
    code_hash = hash_password(code)
    challenge_token = generate_challenge_token()

    db.add(LoginChallenge(
        challenge_token=challenge_token,
        user_id=user.id,
        code_hash=code_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.LOGIN_CHALLENGE_MINUTES),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent", "")[:500],
    ))
    await db.flush()
    await log_action(db, user, "login.email_challenge_sent", request=request, is_sensitive=True)

    # 이메일 발송 비동기 — SMTP 지연이 응답을 막지 않음.
    # BackgroundTasks 없으면 (resend endpoint 등) 직접 await.
    if background is not None:
        background.add_task(
            send_login_code,
            user.email, user.name, code,
            request.client.host if request.client else None,
        )
    else:
        try:
            await send_login_code(
                to=user.email, name=user.name, code=code,
                ip=request.client.host if request.client else None,
            )
        except Exception:
            pass

    resp: dict = {
        "type": "challenge",
        "challenge_token": challenge_token,
        "email_masked": _mask_email(user.email),
        "expires_in_minutes": settings.LOGIN_CHALLENGE_MINUTES,
    }
    # dev 편의: ENV=dev + SMTP 미설정이면 응답에 dev_code 포함 → frontend가 표시.
    # production(ENV!=dev 또는 SMTP_HOST 설정됨)에서는 절대 포함 안 됨 (보안 critical).
    if settings.ENV == "dev" and not settings.SMTP_HOST:
        resp["dev_code"] = code
    return resp


@router.post("/login")
async def login(
    body: LoginRequest, request: Request,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """로그인.

    응답 분기:
    - 학생: 즉시 토큰 발급 (TokenResponse 형태)
    - 교직원 + 신뢰 장치 쿠키 매칭: 즉시 토큰 발급
    - 교직원 + 신뢰 장치 없음: 이메일 코드 발송 + challenge_token 반환
      (응답 type='challenge' — 클라이언트는 /auth/verify-email 호출)
      → 이메일 발송은 BackgroundTasks로 비동기 (SMTP 지연이 응답 막지 않음)
    """
    await login_rate_limit(request)

    result = await db.execute(
        select(User).where(
            or_(User.email == body.identifier, User.username == body.identifier)
        )
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "이메일/아이디 또는 비밀번호가 잘못되었습니다")

    reset_login_rate(request)

    if user.status == "disabled":
        raise HTTPException(403, "비활성화된 계정입니다")

    # 학생은 이메일 2FA 미적용 (학생 보호의 핵심은 교사 계정 도용 차단)
    # super_admin/designated_admin/teacher/staff = 모두 이메일 2FA 대상.
    if user.role == "student":
        token_resp = await _issue_tokens(db, user, request)
        return token_resp.model_dump() | {"type": "token"}

    # 신뢰 장치 쿠키 확인
    device_token = request.cookies.get("device_token")
    trusted = await _find_trusted_device(db, user.id, device_token)
    if trusted:
        trusted.last_used_at = datetime.now(timezone.utc)
        await db.flush()
        token_resp = await _issue_tokens(db, user, request)
        return token_resp.model_dump() | {"type": "token"}

    # 신뢰 장치 없음 → 이메일 챌린지 (BackgroundTasks로 발송)
    return await _start_email_challenge(db, user, request, background=background)


@router.post("/login/verify-email")
async def verify_email_code(
    body: VerifyEmailCodeRequest, request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """이메일 코드 검증 → 토큰 발급. remember_device=True면 신뢰 장치 등록.

    클라이언트는 challenge_token + code 전송. 성공 시 토큰 + 선택적으로
    device_token 쿠키(HttpOnly, Secure) 설정.
    """
    ch = (await db.execute(
        select(LoginChallenge).where(LoginChallenge.challenge_token == body.challenge_token)
    )).scalar_one_or_none()
    if not ch:
        raise HTTPException(400, "유효하지 않은 인증 요청입니다 (다시 로그인하세요)")

    now = datetime.now(timezone.utc)
    # naive datetime fallback (SQLite)
    expires_at = ch.expires_at if ch.expires_at.tzinfo else ch.expires_at.replace(tzinfo=timezone.utc)
    if ch.consumed or expires_at < now:
        raise HTTPException(400, "코드가 만료되었거나 이미 사용되었습니다")
    if ch.attempts >= settings.LOGIN_CHALLENGE_MAX_ATTEMPTS:
        raise HTTPException(429, "시도 횟수 초과 — 다시 로그인하세요")

    ch.attempts += 1
    code = (body.code or "").strip().replace(" ", "")
    if not verify_password(code, ch.code_hash):
        await db.flush()
        remaining = settings.LOGIN_CHALLENGE_MAX_ATTEMPTS - ch.attempts
        raise HTTPException(400, f"코드가 일치하지 않습니다 (남은 시도 {remaining}회)")

    # 성공 — 챌린지 소비
    ch.consumed = True
    user = (await db.execute(select(User).where(User.id == ch.user_id))).scalar_one_or_none()
    if not user or user.status == "disabled":
        raise HTTPException(403, "계정에 접근할 수 없습니다")

    token_resp = await _issue_tokens(db, user, request)

    # 신뢰 장치 등록 옵션
    if body.remember_device:
        device_token_plain = generate_device_token()
        token_hash = hash_password(device_token_plain)
        label = (body.device_label or "").strip()
        if not label:
            ua = (request.headers.get("User-Agent") or "")[:200]
            label = ua or "기기"
        db.add(TrustedDevice(
            user_id=user.id,
            token_hash=token_hash,
            token_prefix=_device_token_prefix(device_token_plain),
            label=label,
            ip_address=request.client.host if request.client else None,
            user_agent=(request.headers.get("User-Agent") or "")[:1000],
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.TRUSTED_DEVICE_DAYS),
        ))
        await db.flush()
        await log_action(
            db, user, "device.trusted_added",
            target=f"label:{label}", request=request, is_sensitive=True,
        )
        # 쿠키 설정 — HttpOnly + SameSite=Lax + secure (production 시)
        # path / max_age. dev에서는 secure=False여야 http에서 동작.
        secure_cookie = not request.url.hostname in ("localhost", "127.0.0.1")
        response.set_cookie(
            key="device_token",
            value=device_token_plain,
            max_age=settings.TRUSTED_DEVICE_DAYS * 24 * 3600,
            httponly=True,
            secure=secure_cookie,
            samesite="lax",
            path="/",
        )

    return token_resp.model_dump() | {"type": "token"}


@router.post("/login/resend-email")
async def resend_email_code(
    body: ResendEmailCodeRequest, request: Request,
    db: AsyncSession = Depends(get_db),
):
    """이메일 코드 재발송 — 동일 challenge_token으로 새 코드 생성.

    공격 방지: 동일 challenge에 대해 60초 쿨다운.
    """
    challenge_token = body.challenge_token.strip()
    if not challenge_token:
        raise HTTPException(400, "challenge_token 필수")
    ch = (await db.execute(
        select(LoginChallenge).where(LoginChallenge.challenge_token == challenge_token)
    )).scalar_one_or_none()
    if not ch or ch.consumed:
        raise HTTPException(400, "유효하지 않은 인증 요청입니다")

    # 쿨다운 — 마지막 생성 후 60초 안에는 재발송 불가
    since = (datetime.now(timezone.utc) - ch.created_at.replace(tzinfo=timezone.utc)).total_seconds() \
        if ch.created_at.tzinfo is None else \
        (datetime.now(timezone.utc) - ch.created_at).total_seconds()
    if since < 60:
        raise HTTPException(429, f"잠시 후 다시 시도하세요 ({60 - int(since)}초)")

    user = (await db.execute(select(User).where(User.id == ch.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "사용자 없음")

    code = generate_verification_code()
    ch.code_hash = hash_password(code)
    ch.attempts = 0
    ch.created_at = datetime.now(timezone.utc)
    ch.expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.LOGIN_CHALLENGE_MINUTES)
    await db.flush()

    try:
        await send_login_code(
            to=user.email, name=user.name, code=code,
            ip=request.client.host if request.client else None,
        )
    except Exception:
        pass

    await log_action(db, user, "login.email_challenge_resent", request=request, is_sensitive=True)
    resp: dict = {"ok": True, "email_masked": _mask_email(user.email)}
    # dev 편의: SMTP 미설정 dev 환경에서만 코드 노출 (위 _start_email_challenge와 동일 정책)
    if settings.ENV == "dev" and not settings.SMTP_HOST:
        resp["dev_code"] = code
    return resp
