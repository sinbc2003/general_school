"""커뮤니티 모델 — 학생 출제 문제, 풀이, 투표"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
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


class CommunityProblem(Base):
    """커뮤니티 출제 문제"""
    __tablename__ = "community_problems"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    solution: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    difficulty: Mapped[str] = mapped_column(String(10), nullable=False)
    question_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(30), default="unverified", nullable=False, index=True
    )  # unverified, community_verified, published, admin_approved
    solve_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vote_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_rating: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    solutions: Mapped[list["CommunitySolution"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )
    votes: Mapped[list["CommunityVote"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_community_problems_author_id", "author_id"),
    )


class CommunitySolution(Base):
    """커뮤니티 풀이"""
    __tablename__ = "community_solutions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("community_problems.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    problem: Mapped["CommunityProblem"] = relationship(back_populates="solutions")

    __table_args__ = (
        Index("ix_community_solutions_problem_id", "problem_id"),
        Index("ix_community_solutions_author_id", "author_id"),
    )


class CommunityVote(Base):
    """커뮤니티 투표"""
    __tablename__ = "community_votes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("community_problems.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False)  # 1~5
    accuracy_vote: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    difficulty_appropriate: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    problem: Mapped["CommunityProblem"] = relationship(back_populates="votes")

    __table_args__ = (
        UniqueConstraint("user_id", "problem_id", name="uq_community_vote"),
    )
