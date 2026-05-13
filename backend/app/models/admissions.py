"""진학 모델 — 기출문제, 진학기록, 학생응답"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AdmissionsQuestion(Base):
    """진학 기출문제"""
    __tablename__ = "admissions_questions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    university: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    admission_type: Mapped[str] = mapped_column(String(100), nullable=False)
    question_type: Mapped[str] = mapped_column(String(50), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_admissions_questions_university", "university"),
        Index("ix_admissions_questions_year", "year"),
        Index("ix_admissions_questions_question_type", "question_type"),
        Index("ix_admissions_questions_admission_type", "admission_type"),
    )


class AdmissionsRecord(Base):
    """진학 기록 (졸업생 결과)"""
    __tablename__ = "admissions_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    graduation_year: Mapped[int] = mapped_column(Integer, nullable=False)
    results: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    portfolio_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_admissions_records_student_id", "student_id"),
        Index("ix_admissions_records_graduation_year", "graduation_year"),
    )


class AdmissionsResponse(Base):
    """학생 기출 연습 응답"""
    __tablename__ = "admissions_responses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(
        ForeignKey("admissions_questions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    response: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_admissions_responses_question_id", "question_id"),
        Index("ix_admissions_responses_user_id", "user_id"),
    )
