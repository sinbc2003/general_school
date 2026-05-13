"""학생 포트폴리오 모델 — 성적, 모의고사, 수상, 논문, 상담, 생기부"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
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


class StudentGrade(Base):
    """학생 과목별 지필평가 성적"""
    __tablename__ = "student_grades"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_type: Mapped[str] = mapped_column(String(20), nullable=False)  # midterm, final
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    max_score: Mapped[float] = mapped_column(Float, default=100.0, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    grade_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_students: Mapped[int | None] = mapped_column(Integer, nullable=True)
    average: Mapped[float | None] = mapped_column(Float, nullable=True)
    standard_deviation: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_grades_student_id", "student_id"),
        Index("ix_student_grades_year_semester", "year", "semester"),
        Index("ix_student_grades_subject", "subject"),
    )


class StudentMockExam(Base):
    """모의고사 성적"""
    __tablename__ = "student_mock_exams"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    exam_name: Mapped[str] = mapped_column(String(200), nullable=False)
    exam_date: Mapped[date] = mapped_column(Date, nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    raw_score: Mapped[float] = mapped_column(Float, nullable=False)
    standard_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentile: Mapped[float | None] = mapped_column(Float, nullable=True)
    grade_level: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 등급 1~9
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_mock_exams_student_id", "student_id"),
        Index("ix_student_mock_exams_exam_date", "exam_date"),
    )


class StudentAward(Base):
    """수상 기록"""
    __tablename__ = "student_awards"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    award_type: Mapped[str] = mapped_column(String(50), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    award_level: Mapped[str] = mapped_column(String(50), nullable=False)
    award_date: Mapped[date] = mapped_column(Date, nullable=False)
    organizer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_awards_student_id", "student_id"),
        Index("ix_student_awards_category", "category"),
        Index("ix_student_awards_award_date", "award_date"),
    )


class StudentThesis(Base):
    """논문/졸업논문"""
    __tablename__ = "student_theses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    thesis_type: Mapped[str] = mapped_column(String(50), nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    advisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    coauthors: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    journal: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="in_progress", nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_theses_student_id", "student_id"),
        Index("ix_student_theses_thesis_type", "thesis_type"),
        Index("ix_student_theses_status", "status"),
    )


class StudentCounseling(Base):
    """상담 기록"""
    __tablename__ = "student_counselings"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    counselor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    counseling_date: Mapped[date] = mapped_column(Date, nullable=False)
    counseling_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    follow_up: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_counselings_student_id", "student_id"),
        Index("ix_student_counselings_counselor_id", "counselor_id"),
        Index("ix_student_counselings_counseling_date", "counseling_date"),
        Index("ix_student_counselings_counseling_type", "counseling_type"),
    )


class StudentRecord(Base):
    """학생 생활기록부 영역별 기록"""
    __tablename__ = "student_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    record_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # behavior, autonomous, career
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_records_student_id", "student_id"),
        Index("ix_student_records_year_semester", "year", "semester"),
        Index("ix_student_records_type", "record_type"),
    )
