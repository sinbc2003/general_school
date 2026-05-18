"""인증 라우터 — 로그인, 토큰 갱신, 2FA, 비밀번호 변경.

분할 구조 (sub-router 패턴):
- _helpers.py — _user_to_dict, _check_must_enable_2fa
- registration.py — bootstrap-status + register (첫 가입)
- login_flow.py — login + verify-email + resend-email (이메일 2FA 챌린지 포함)
- session.py — refresh, logout, /me, change-password, password-policy
- two_factor.py — TOTP 기반 2FA setup/confirm/verify/disable (기존)
- devices.py — 신뢰 장치 관리 (기존)

본 파일은 APIRouter() 생성과 sub-module 등록만 담당.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/auth", tags=["auth"])


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.auth import registration  # noqa: E402, F401
from app.modules.auth import login_flow  # noqa: E402, F401
from app.modules.auth import session  # noqa: E402, F401
from app.modules.auth import two_factor  # noqa: E402, F401
from app.modules.auth import devices  # noqa: E402, F401
