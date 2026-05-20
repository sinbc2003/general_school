"""통합 사용자 모델 — 모든 역할(관리자/교사/직원/학생)을 하나의 테이블로 관리"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
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
    # 계정 활성 상태: approved | disabled
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="approved", index=True)
    # 인사 상태 (계정 활성과 별개): active | departed | graduated | transferred
    # - active: 재직/재학 중
    # - departed: 전출/퇴직 (교사) — 자료 영구 보존, 로그인 가능 여부는 status로 별도 제어
    # - graduated: 졸업 (학생)
    # - transferred: 전학 (학생)
    lifecycle_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active", index=True,
    )
    # 계정 종류: regular | temporary | substitute
    # - regular: 정규 교사/학생
    # - temporary: 시간강사 (단기, expires_at 도래 시 자동 비활성화)
    # - substitute: 임시 부담임/대리 강사
    user_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="regular", index=True,
    )
    # 임시 계정 만료일 (user_type=temporary/substitute 시). NULL이면 만료 없음.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # 학생 전용 필드
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 교사/직원 전용 필드 — 부서명 (deprecated: department_id 사용 권장).
    # 신규 도입한 Department FK가 정식 source of truth.
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # use_alter=True: alembic이 별도 ALTER TABLE로 FK 추가.
    # backup.py의 Base.metadata.sorted_tables에서 cycle 정렬 시 이 FK를 무시 → SAWarning 해소.
    # 양방향 FK (Department.lead_user_id ↔ User.department_id) 중 한쪽만 alter면 충분.
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL", use_alter=True, name="fk_users_department_id"),
        nullable=True, index=True,
    )

    # 학년부장 — Department의 lead_user_id와는 별개 (학년부장은 별도 개념).
    # is_grade_lead=True 이면 lead_grade(1/2/3)의 학년부 강좌 owner로 자동 등록.
    is_grade_lead: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    lead_grade: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 드라이브 quota (개인 도구 자료만 차감. 클래스룸·산출물·과제는 학교 공통 = 무관).
    quota_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # Google Workspace / Gmail (Phase 1.5 연동).
    google_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # 연락처 (CSV import 시 초기 비밀번호 = phone, '-' 제거)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

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
