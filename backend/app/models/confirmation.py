"""학생 확인("이상없음") — 생기부·수행평가·성적 공통 확인 모델.

학생이 본인 데이터를 검토하고 '이상없음' 또는 '수정 요청(사유)'을 남긴다.
kind + ref_key 로 어떤 데이터를 확인했는지 식별:

  - record     : ref_key = RecordProject.id (공개된 본인 생기부)
  - submission : ref_key = CoursePostSubmission.id (returned 제출물 — 수행평가 점수·피드백)
  - grades     : ref_key = "{year}-{semester}" (해당 학기 지필 성적 묶음)

UNIQUE(student_id, kind, ref_key) — 재확인 시 upsert (마지막 상태가 유효).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StudentConfirmation(Base):
    __tablename__ = "student_confirmations"
    __table_args__ = (
        UniqueConstraint("student_id", "kind", "ref_key", name="uq_student_confirmation"),
        Index("ix_student_confirmations_kind_ref", "kind", "ref_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # record | submission | grades
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    ref_key: Mapped[str] = mapped_column(String(50), nullable=False)
    # confirmed(이상없음) | revision_requested(수정요청)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
