"""학생 본인 전용 모델 — 산출물 업로드, 진로/진학 설계"""

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, String, Text, JSON, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StudentArtifact(Base):
    """학생이 직접 업로드하는 산출물 (포트폴리오용)
    예: 보고서 PDF, 프로젝트 결과 이미지, 영상, 발표자료 등
    """
    __tablename__ = "student_artifacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 분류: "report" | "presentation" | "project" | "media" | "other"
    category: Mapped[str] = mapped_column(String(40), default="other", nullable=False)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_link: Mapped[str | None] = mapped_column(String(500), nullable=True)  # YouTube/GitHub 등
    tags: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 다른 학생에게 공개
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_artifacts_category", "category"),
    )


class StudentCareerPlan(Base):
    """학생 진로/진학 설계 — 학생이 직접 작성하는 종합 진학 계획서

    한 학생당 학년별로 여러 버전 가능 (학년 올라가면서 보완).
    """
    __tablename__ = "student_career_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)  # 작성 연도
    # 진로 방향
    desired_field: Mapped[str | None] = mapped_column(String(200), nullable=True)  # 희망 진로 분야
    career_goal: Mapped[str | None] = mapped_column(Text, nullable=True)  # 장래 희망/직업
    # 진학 목표
    target_universities: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    # [{"university": "서울대", "major": "수리과학부", "admission_type": "수시", "priority": 1}, ...]
    target_majors: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    # 학업/활동 계획
    academic_plan: Mapped[str | None] = mapped_column(Text, nullable=True)  # 학업 계획
    activity_plan: Mapped[str | None] = mapped_column(Text, nullable=True)  # 비교과 활동 계획
    semester_goals: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    # [{"semester": "1-1", "goal": "..."}, ...]
    motivation: Mapped[str | None] = mapped_column(Text, nullable=True)  # 진학 동기 / 자기소개 초안
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_student_career_plans_year", "year"),
    )
