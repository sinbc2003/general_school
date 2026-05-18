"""부트스트랩 + 첫 회원가입 endpoints.

첫 사용자가 자동으로 super_admin이 되는 first_signup 모드.
PostgreSQL advisory lock으로 동시 가입 race condition 방어.

router 객체는 router.py에서 공유. router.py 끝의 'from . import registration'으로 등록.
"""

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import (
    create_access_token, create_refresh_token_value, hash_password,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import resolve_permissions
from app.models.user import RefreshToken, User
from app.modules.auth.schemas import (
    BootstrapStatus, RegisterRequest, TokenResponse,
)

from app.modules.auth.router import router
from app.modules.auth._helpers import _user_to_dict


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

    동시 가입 race condition 방어:
    - PostgreSQL: pg_advisory_xact_lock으로 트랜잭션 직렬화
    - SQLite/그 외: count 체크만 (단일 worker dev 환경 가정)
    트랜잭션 종료 시 lock 자동 해제.
    """
    mode = (settings.BOOTSTRAP_MODE or "first_signup").lower()
    if mode != "first_signup":
        raise HTTPException(403, "회원가입이 비활성화되어 있습니다 (BOOTSTRAP_MODE)")

    # PostgreSQL advisory lock — register 동시 호출 직렬화.
    # lock key는 register용 고정값 (다른 lock과 충돌 회피 위해 register-specific).
    dialect = db.bind.dialect.name if db.bind else ""
    if dialect == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=0x5343_5245_4749_5354))  # "SCREGIST"

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
    if not name or not email or not username:
        raise HTTPException(400, "이름, 이메일, 아이디는 필수입니다")
    from app.core.password_policy import validate_password
    try:
        await validate_password(db, password)
    except ValueError as e:
        raise HTTPException(400, str(e))

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
