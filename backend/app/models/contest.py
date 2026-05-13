"""대회 모델 — 대회, 참가자, 문제, 팀, 제출"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ContestStatus(str, enum.Enum):
    UPCOMING = "upcoming"
    ACTIVE = "active"
    ENDED = "ended"
    ARCHIVED = "archived"


class Contest(Base):
    """대회 — 학기 단위로 격리 (semester_id 필수)."""
    __tablename__ = "contests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    contest_type: Mapped[str] = mapped_column(
        String(20), default="individual", nullable=False
    )  # individual, team
    status: Mapped[ContestStatus] = mapped_column(
        Enum(ContestStatus), default=ContestStatus.UPCOMING, nullable=False
    )
    rules: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    end_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    problems: Mapped[list["ContestProblem"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan"
    )
    participants: Mapped[list["ContestParticipant"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan"
    )
    teams: Mapped[list["ContestTeam"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["ContestSubmission"]] = relationship(
        back_populates="contest", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_contests_semester_id", "semester_id"),
        Index("ix_contests_status", "status"),
        Index("ix_contests_is_visible", "is_visible"),
    )


class ContestProblem(Base):
    """대회 문제"""
    __tablename__ = "contest_problems"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contest_id: Mapped[int] = mapped_column(
        ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    problem_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    points: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contest: Mapped["Contest"] = relationship(back_populates="problems")

    __table_args__ = (
        UniqueConstraint("contest_id", "problem_number", name="uq_contest_problem_number"),
        Index("ix_contest_problems_contest_id", "contest_id"),
    )


class ContestParticipant(Base):
    """대회 참가자"""
    __tablename__ = "contest_participants"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contest_id: Mapped[int] = mapped_column(
        ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contest: Mapped["Contest"] = relationship(back_populates="participants")

    __table_args__ = (
        UniqueConstraint("contest_id", "user_id", name="uq_contest_participant"),
        Index("ix_contest_participants_contest_id", "contest_id"),
        Index("ix_contest_participants_user_id", "user_id"),
    )


class ContestTeam(Base):
    """대회 팀"""
    __tablename__ = "contest_teams"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contest_id: Mapped[int] = mapped_column(
        ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    members: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contest: Mapped["Contest"] = relationship(back_populates="teams")

    __table_args__ = (
        Index("ix_contest_teams_contest_id", "contest_id"),
    )


class ContestSubmission(Base):
    """대회 제출 (학생)"""
    __tablename__ = "contest_submissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    contest_id: Mapped[int] = mapped_column(
        ForeignKey("contests.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("contest_teams.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    contest: Mapped["Contest"] = relationship(back_populates="submissions")

    __table_args__ = (
        Index("ix_contest_submissions_contest_id", "contest_id"),
        Index("ix_contest_submissions_user_id", "user_id"),
    )
