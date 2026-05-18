from pydantic import BaseModel


class LoginRequest(BaseModel):
    identifier: str  # email 또는 username
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


class RefreshRequest(BaseModel):
    refresh_token: str


class TwoFactorSetupResponse(BaseModel):
    secret: str
    qr_code: str  # base64 PNG
    uri: str


class TwoFactorConfirmRequest(BaseModel):
    code: str


class TwoFactorVerifyRequest(BaseModel):
    code: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RegisterRequest(BaseModel):
    """첫 회원가입 (BOOTSTRAP_MODE=first_signup일 때만 동작).
    User count가 0일 때만 통과 — 가입자가 자동으로 super_admin이 됨.
    """
    name: str
    email: str
    username: str
    password: str


class BootstrapStatus(BaseModel):
    """가입 페이지가 호출 — 첫 가입 가능 여부"""
    can_register: bool
    bootstrap_mode: str
    user_count: int


# ── 이메일 2FA ──────────────────────────────────────────────────────

class LoginChallengeResponse(BaseModel):
    """비밀번호는 통과했으나 이메일 코드가 필요할 때 반환.

    응답 차별화:
      type='token'    : 즉시 발급된 토큰 (학생 / 신뢰 장치)
      type='challenge': 이메일 코드 입력 단계로 진입 필요
    """
    type: str  # 'token' | 'challenge'
    challenge_token: str
    email_masked: str  # 'jo***@example.com'
    expires_in_minutes: int


class VerifyEmailCodeRequest(BaseModel):
    challenge_token: str
    code: str
    remember_device: bool = False
    # 라벨 자유 입력 가능 — 비어있으면 User-Agent에서 추론
    device_label: str | None = None


class ResendEmailCodeRequest(BaseModel):
    """POST /api/auth/login/resend-email"""
    challenge_token: str


class TrustedDeviceItem(BaseModel):
    id: int
    label: str | None
    ip_address: str | None
    last_used_at: str | None
    expires_at: str
    created_at: str
    current: bool
