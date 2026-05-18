"""신뢰 장치 + 로그인 챌린지 (이메일 2FA).

흐름:
1. 교직원이 로그인 → 비밀번호 통과
2. 장치 쿠키(device_token)가 있고 DB의 TrustedDevice와 매칭 + 만료 안 됨
   → 즉시 토큰 발급 (skip email 2FA)
3. 없으면 LoginChallenge 생성 + 이메일로 6자리 코드 발송
   → 클라이언트는 challenge_id 받음 → 코드 입력 → /verify-email
4. 코드 검증 성공 + remember_device=True면 새 TrustedDevice 발급 + 쿠키 설정
"""

import secrets
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Integer, String, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrustedDevice(Base):
    """사용자가 '이 장치 기억' 옵션으로 등록한 신뢰 장치.

    device_token은 평문 검증용이 아니라 hash 비교 (security).
    실제 cookie 값은 token_plaintext, DB에는 hash만 저장.
    """
    __tablename__ = "trusted_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # bcrypt-style hash of the device token (cookie value)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # token의 앞 12자 (평문) — 인덱스로 빠른 lookup용.
    # token 자체는 32바이트 base64라 prefix 충돌 가능성 매우 낮음.
    # 운영 시: cookie 값으로 lookup → 후보 1~few개 → bcrypt 검증.
    # 추가: prefix만으로는 cookie 위조 불가 (전체 token + bcrypt 매칭 필요).
    token_prefix: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    # 표시용 라벨 (User-Agent에서 추출 또는 사용자 입력)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


class LoginChallenge(Base):
    """이메일 2FA 진행 중인 임시 챌린지.

    /login에서 비밀번호 통과 후 발급. 사용자가 /verify-email로 코드 제출 시
    소비. 만료(10분) / 시도횟수 초과(5회) 시 무효.
    """
    __tablename__ = "login_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 클라이언트가 들고 다닐 challenge_id (URL-safe random token)
    challenge_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 6자리 코드의 hash (평문 저장 X)
    code_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )


def generate_device_token() -> str:
    """장치 쿠키 값. URL-safe 32바이트 (256-bit)."""
    return secrets.token_urlsafe(32)


def generate_challenge_token() -> str:
    """challenge id. URL-safe 24바이트."""
    return secrets.token_urlsafe(24)


def generate_verification_code() -> str:
    """6자리 숫자 코드."""
    return f"{secrets.randbelow(10**6):06d}"
