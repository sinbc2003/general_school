"""Fernet 기반 대칭 암호화 — 민감 데이터 저장 시 사용"""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _derive_key(master_key: str) -> bytes:
    digest = hashlib.sha256(master_key.encode()).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_key(settings.ENCRYPTION_MASTER_KEY))


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()


def mask_secret(secret: str, keep_prefix: int = 4, keep_suffix: int = 4) -> str:
    """API 키 등 민감 문자열 마스킹: 앞뒤만 노출"""
    if not secret:
        return ""
    if len(secret) <= keep_prefix + keep_suffix:
        return "*" * len(secret)
    return f"{secret[:keep_prefix]}{'*' * 12}{secret[-keep_suffix:]}"
