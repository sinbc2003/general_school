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
