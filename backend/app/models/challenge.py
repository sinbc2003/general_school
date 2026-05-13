"""챌린지 모델 — 레벨, 문제, 진행"""

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
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ChallengeLevel(Base):
    """챌린지 레벨"""
    __tablename__ = "challenge_levels"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    level_number: Mapped[int] = mapped_column(Integer, nullable=False)
    unlock_threshold: Mapped[int] = mapped_column(Integer, default=70, nullable=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    problems: Mapped[list["ChallengeProblem"]] = relationship(
        back_populates="level", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_challenge_levels_category_number", "category", "level_number"),
    )


class ChallengeProblem(Base):
    """챌린지 문제"""
    __tablename__ = "challenge_problems"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    level_id: Mapped[int] = mapped_column(
        ForeignKey("challenge_levels.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str] = mapped_column(String(10), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    points: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    level: Mapped["ChallengeLevel"] = relationship(back_populates="problems")

    __table_args__ = (
        Index("ix_challenge_problems_level_id", "level_id"),
    )


class ChallengeProgress(Base):
    """학생 챌린지 진행"""
    __tablename__ = "challenge_progress"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("challenge_problems.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), default="not_started", nullable=False
    )
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    solved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("user_id", "problem_id", name="uq_challenge_user_problem"),
        Index("ix_challenge_progress_user_id", "user_id"),
    )
