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
from app.core.ratelimit import login_rate_limit, reset_login_rate
from app.models.user import User, RefreshToken
from app.modules.auth.schemas import (
    LoginRequest,
    TokenResponse,
    RefreshRequest,
    TwoFactorSetupResponse,
    TwoFactorConfirmRequest,
    TwoFactorVerifyRequest,
    ChangePasswordRequest,
    RegisterRequest,
    BootstrapStatus,
)
from sqlalchemy import func

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


@router.get("/bootstrap-status", response_model=BootstrapStatus)
async def bootstrap_status(db: AsyncSession = Depends(get_db)):
    """첫 가입 가능 여부 확인 (frontend register 페이지에서 호출).
    - first_signup 모드 + User 수 == 0 → can_register=true (다음 가입자가 super_admin)
    - 그 외 → can_register=false (관리자가 CSV로 등록)
    """
    count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    mode = (settings.BOOTSTRAP_MODE or "first_signup").lower()
    return BootstrapStatus(
        can_register=(mode == "first_signup" and count == 0),
        bootstrap_mode=mode,
        user_count=count,
    )


@router.post("/register", response_model=TokenResponse)
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """첫 회원가입 — User count==0이고 BOOTSTRAP_MODE=first_signup일 때만 동작.
    가입자가 자동으로 super_admin으로 등록되고 즉시 로그인 토큰 발급.
    """
    mode = (settings.BOOTSTRAP_MODE or "first_signup").lower()
    if mode != "first_signup":
        raise HTTPException(403, "회원가입이 비활성화되어 있습니다 (BOOTSTRAP_MODE)")

    count = (await db.execute(select(func.count(User.id)))).scalar() or 0
    if count > 0:
        raise HTTPException(
            403,
            "이미 사용자가 등록되어 있습니다. 추가 사용자는 최고관리자가 직접 등록(CSV 업로드)해야 합니다."
        )

    # 검증
    name = (body.name or "").strip()
    email = (body.email or "").strip().lower()
    username = (body.username or "").strip()
    password = body.password or ""
    if not name or not email or not username or len(password) < 8:
        raise HTTPException(400, "이름, 이메일, 아이디, 8자 이상 비밀번호 모두 필요합니다")

    new_user = User(
        username=username,
        email=email,
        name=name,
        password_hash=hash_password(password),
        role="super_admin",
        status="approved",
        must_change_password=False,
    )
    db.add(new_user)
    await db.flush()
    await log_action(db, new_user, "register_super_admin", request=request)

    # 즉시 로그인 토큰 발급
    access_token = create_access_token(new_user.id, new_user.role)
    refresh_value = create_refresh_token_value()
    db.add(RefreshToken(
        user_id=new_user.id, token=refresh_value,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    await db.flush()

    perms = await resolve_permissions(db, new_user)
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_value,
        user=_user_to_dict(new_user, perms),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # Rate limit (IP 기준 1분 5회) — 무차별 시도 방어
    await login_rate_limit(request)

    # email 또는 username으로 사용자 검색
    result = await db.execute(
        select(User).where(
            or_(User.email == body.identifier, User.username == body.identifier)
        )
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "이메일/아이디 또는 비밀번호가 잘못되었습니다")

    # 성공 시 카운터 리셋 (정상 사용자 영향 최소화)
    reset_login_rate(request)

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
