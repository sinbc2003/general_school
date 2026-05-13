"""통합 사용자 모델 — 모든 역할(관리자/교사/직원/학생)을 하나의 테이블로 관리"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    picture: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # 역할: super_admin | designated_admin | teacher | staff | student
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student", index=True)
    # 상태: approved | disabled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="approved", index=True)

    # 학생 전용 필드
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 교사/직원 전용 필드
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # 2FA (TOTP)
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)

    # 비밀번호 변경 필요 여부 (엑셀 임포트 후 첫 로그인 시)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)

    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TOTPSession(Base):
    """2FA 인증 세션 — 인증 후 일정 시간 동안 재인증 불필요"""
    __tablename__ = "totp_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
