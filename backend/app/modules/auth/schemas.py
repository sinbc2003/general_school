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
