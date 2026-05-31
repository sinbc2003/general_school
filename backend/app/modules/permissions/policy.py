"""권한 시스템 정책 endpoints (super_admin 전용).

- 지정관리자 모드 (full/scoped)
- admin 2FA 강제
- 비밀번호 복잡도 정책

router 객체는 router.py에서 공유. router.py 끝의 'from . import policy'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_2fa_session
from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_super_admin
from app.models.user import User

from app.modules.permissions.router import router, _invalidate_role_sessions
from app.modules.permissions.schemas import (
    AdminTwoFaRequiredUpdate,
    DesignatedAdminModeUpdate,
    PasswordPolicyUpdate,
)


# ── 지정관리자 모드 ──

@router.get("/policy/designated-admin-mode")
async def get_designated_admin_mode_endpoint(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """현재 지정관리자 모드 조회."""
    from app.core.permissions import (
        get_designated_admin_mode,
        VALID_DESIGNATED_ADMIN_MODES,
    )
    return {
        "mode": await get_designated_admin_mode(db),
        "options": [
            {
                "value": "full",
                "label": "전체 권한 (디폴트)",
                "description": "지정관리자는 최고관리자 전용 권한을 제외한 모든 권한 자동 보유.",
            },
            {
                "value": "scoped",
                "label": "세분화 (매트릭스 토글)",
                "description": "지정관리자도 일반 역할처럼 매트릭스에서 명시 부여한 권한만 보유.",
            },
        ],
        "valid": sorted(VALID_DESIGNATED_ADMIN_MODES),
    }


@router.put("/policy/designated-admin-mode")
async def set_designated_admin_mode_endpoint(
    body: DesignatedAdminModeUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """지정관리자 모드 변경. 'full' ↔ 'scoped'.

    모드 변경 시 모든 designated_admin 사용자의 세션 무효화 (권한 셋이 달라짐).
    2FA 필수 (정책 변경은 영향력 큼).
    """
    from app.core.permissions import set_designated_admin_mode
    await verify_2fa_session(user, request, db)

    mode = body.mode  # Literal 검증 완료
    await set_designated_admin_mode(db, mode)
    invalidated = await _invalidate_role_sessions(db, "designated_admin")
    await db.flush()
    await log_action(
        db, user, "policy.designated_admin_mode",
        target=f"mode:{mode} sessions_invalidated:{invalidated}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "mode": mode, "sessions_invalidated": invalidated}


# ── admin 2FA 강제 ──

@router.get("/policy/admin-2fa-required")
async def get_admin_2fa_required_endpoint(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """admin 2FA 강제 여부 조회."""
    from app.core.permissions import get_admin_2fa_required
    return {
        "required": await get_admin_2fa_required(db),
        "description": (
            "True면 super_admin/designated_admin은 2FA 등록 필수. "
            "미등록 admin은 로그인 후 /auth/2fa-setup으로 강제 redirect."
        ),
    }


@router.put("/policy/admin-2fa-required")
async def set_admin_2fa_required_endpoint(
    body: AdminTwoFaRequiredUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """admin 2FA 강제 여부 변경. 2FA 필수.
    True로 변경 시 본인(super_admin)이 2FA 미등록이면 거부 — 자기 잠금 방지.
    """
    from app.core.permissions import set_admin_2fa_required
    await verify_2fa_session(user, request, db)

    required = body.required

    # 자기 잠금 방지: True 전환 시 본인이 2FA 미등록이면 거부
    if required and not user.totp_enabled:
        raise HTTPException(
            400,
            "정책을 켜기 전에 먼저 본인의 2FA를 등록하세요. (/auth/2fa-setup)",
        )

    await set_admin_2fa_required(db, required)
    await db.flush()
    await log_action(
        db, user, "policy.admin_2fa_required",
        target=f"required:{required}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "required": required}


@router.get("/policy/sensitive-2fa-required")
async def get_sensitive_2fa_required_endpoint(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """민감데이터 이메일 2FA 강제 여부 조회."""
    from app.core.permissions import get_sensitive_data_2fa_required
    return {
        "required": await get_sensitive_data_2fa_required(db),
        "description": (
            "True면 교직원/관리자는 성적·상담 등 민감데이터 접근 시 2차 인증(이메일 코드 또는 TOTP) 필요. "
            "인증앱 설치 불필요 — 이메일 로그인 시 자동 발급되고 만료 시 이메일 코드로 재인증. 학생은 면제. "
            "이메일 발송용 SMTP 설정이 선행되어야 함."
        ),
    }


@router.put("/policy/sensitive-2fa-required")
async def set_sensitive_2fa_required_endpoint(
    body: AdminTwoFaRequiredUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """민감데이터 이메일 2FA 강제 여부 변경. (켜기 전 SMTP 설정 필수)"""
    from app.core.permissions import set_sensitive_data_2fa_required
    await verify_2fa_session(user, request, db)
    required = body.required
    await set_sensitive_data_2fa_required(db, required)
    await db.flush()
    await log_action(
        db, user, "policy.sensitive_data_2fa_required",
        target=f"required:{required}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "required": required}


# ── 비밀번호 정책 ──

@router.get("/policy/password")
async def get_password_policy_admin(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """비밀번호 정책 상세 조회 (관리자 — 편집용 정보 포함)."""
    from app.core.password_policy import describe_policy
    return await describe_policy(db)


@router.put("/policy/password")
async def update_password_policy(
    body: PasswordPolicyUpdate, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """비밀번호 정책 변경 (부분 업데이트). 2FA 필수."""
    from app.core.password_policy import set_policy, describe_policy
    await verify_2fa_session(user, request, db)
    patch = body.model_dump(exclude_unset=True)
    try:
        await set_policy(db, patch)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.flush()
    await log_action(
        db, user, "policy.password",
        target=f"updated:{sorted(patch.keys())}", request=request, is_sensitive=True,
    )
    return {"ok": True, **(await describe_policy(db))}
