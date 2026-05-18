"""직책/업무분장 기반 학기 권한 모델

설계 동기:
- 권한이 글로벌(role_permissions, user_permissions)이면 학기 종료 후에도 잔존.
- 학교 운영은 매 학기 업무분장이 갱신됨 ("올해 1학년 담임", "동아리 담당교사",
  "정보 부장" 등).
- 학기 단위로 직책 → 권한을 매핑하면 학기 종료 시 자동 회수.

핵심 흐름:
1. super_admin/designated_admin이 PositionTemplate을 정의
   (예: "1학년 담임"이라는 키와 부여할 권한 키 묶음)
2. 학기 명단(SemesterEnrollment) 한 줄에 여러 PositionTemplate을 할당
   (EnrollmentPosition으로 N:N 매핑)
3. resolve_permissions가 현재 학기의 본인 enrollment를 보고
   직책 → 권한 키 합집합을 더해줌
4. 학기가 바뀌면 새 enrollment는 직책이 없는 상태로 시작 → 자동 회수

확장성:
- 새 권한 키가 모듈에서 추가돼도 PositionTemplate.permission_keys에 넣기만 하면
  즉시 해당 직책을 가진 모든 교사에게 부여됨.
- 부서별 권한, 학년별 권한 등도 같은 패턴으로 직책으로 표현 가능
  ("수학과 부장", "1학년 부장" 등).
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PositionTemplate(Base):
    """직책/업무분장 권한 템플릿.

    학교가 자유롭게 정의 (예: "1학년 담임", "동아리 담당교사", "진로 진학 부장").
    permission_keys는 JSON 직렬화된 문자열 (list[str]).
    DB에 정의된 권한 키만 유효 — 키 검증은 라우터/시드에서 수행.
    """
    __tablename__ = "position_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 분류 (예: "담임", "부장", "동아리", "기타"). UI 그룹핑용.
    category: Mapped[str] = mapped_column(String(50), default="기타", nullable=False)
    # JSON list of permission key strings. 존재하지 않는 키는 resolve 시점에 필터됨.
    permission_keys: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    # 시스템 기본 템플릿 — 학교가 삭제하지 못하게 보호. 일반 커스텀 = False.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EnrollmentPosition(Base):
    """학기 enrollment에 부여된 직책 (N:N 매핑).

    한 enrollment(=학기·사용자 한 행)에 여러 직책 동시 가능
    ("3-2 담임" + "동아리 담당교사" + "정보 부장").

    enrollment이 cascade 삭제되면 함께 정리. 학기가 바뀌면 새 enrollment에
    별도로 직책을 할당해야 함 (자동 회수).
    """
    __tablename__ = "enrollment_positions"
    __table_args__ = (
        UniqueConstraint(
            "enrollment_id", "position_template_id",
            name="uq_enrollment_position",
        ),
        Index("ix_enrollment_positions_enrollment_id", "enrollment_id"),
        Index("ix_enrollment_positions_template_id", "position_template_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    enrollment_id: Mapped[int] = mapped_column(
        ForeignKey("semester_enrollments.id", ondelete="CASCADE"),
        nullable=False,
    )
    position_template_id: Mapped[int] = mapped_column(
        ForeignKey("position_templates.id", ondelete="CASCADE"),
        nullable=False,
    )
    granted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
