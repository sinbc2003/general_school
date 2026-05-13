"""연구 모델 — R&E 프로젝트, 연구일지, 산출물, 학생저널"""

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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ResearchProject(Base):
    """R&E 연구 프로젝트"""
    __tablename__ = "research_projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    research_type: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    advisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    members: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    milestones: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planning", nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    logs: Mapped[list["ResearchLog"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["ResearchSubmission"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
    journals: Mapped[list["ResearchJournal"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_research_projects_year", "year"),
        Index("ix_research_projects_status", "status"),
        Index("ix_research_projects_research_type", "research_type"),
        Index("ix_research_projects_advisor_id", "advisor_id"),
    )


class ResearchLog(Base):
    """연구 일지 (교사 작성)"""
    __tablename__ = "research_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("research_projects.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    log_type: Mapped[str] = mapped_column(String(50), nullable=False)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    feedback_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    project: Mapped["ResearchProject"] = relationship(back_populates="logs")

    __table_args__ = (
        Index("ix_research_logs_project_id", "project_id"),
        Index("ix_research_logs_log_type", "log_type"),
    )


class ResearchSubmission(Base):
    """연구 산출물"""
    __tablename__ = "research_submissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("research_projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    submission_type: Mapped[str] = mapped_column(String(50), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    submitted_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    review_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    project: Mapped["ResearchProject"] = relationship(back_populates="submissions")

    __table_args__ = (
        Index("ix_research_submissions_project_id", "project_id"),
        Index("ix_research_submissions_review_status", "review_status"),
    )


class ResearchJournal(Base):
    """학생 연구 저널"""
    __tablename__ = "research_journals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("research_projects.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    week_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    project: Mapped["ResearchProject"] = relationship(back_populates="journals")

    __table_args__ = (
        Index("ix_research_journals_project_id", "project_id"),
        Index("ix_research_journals_author_id", "author_id"),
    )
