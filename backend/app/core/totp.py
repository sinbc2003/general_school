"""TOTP 2차 인증 헬퍼"""

import io
import base64
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.encryption import encrypt, decrypt
from app.models.user import TOTPSession


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=settings.TOTP_ISSUER)


def generate_qr_base64(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def verify_totp_code(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def encrypt_secret(secret: str) -> str:
    return encrypt(secret)


def decrypt_secret(encrypted: str) -> str:
    return decrypt(encrypted)


async def create_totp_session(
    db: AsyncSession,
    user_id: int,
    ip_address: str | None,
) -> TOTPSession:
    now = datetime.now(timezone.utc)
    session = TOTPSession(
        user_id=user_id,
        verified_at=now,
        expires_at=now + timedelta(minutes=settings.TOTP_SESSION_MINUTES),
        ip_address=ip_address,
    )
    db.add(session)
    await db.flush()
    return session
