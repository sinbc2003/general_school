"""동아리 모델 — 동아리, 활동, 제출"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
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


class Club(Base):
    """동아리 — 학기 단위로 격리 (semester_id 필수). 기존 year는 호환을 위해 유지."""
    __tablename__ = "clubs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    advisor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    members: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    budget: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    activities: Mapped[list["ClubActivity"]] = relationship(
        back_populates="club", cascade="all, delete-orphan"
    )
    submissions: Mapped[list["ClubSubmission"]] = relationship(
        back_populates="club", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_clubs_semester_id", "semester_id"),
        Index("ix_clubs_year", "year"),
        Index("ix_clubs_status", "status"),
        Index("ix_clubs_advisor_id", "advisor_id"),
    )


class ClubActivity(Base):
    """동아리 활동"""
    __tablename__ = "club_activities"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    club_id: Mapped[int] = mapped_column(
        ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    activity_date: Mapped[date] = mapped_column(Date, nullable=False)
    attendees: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    attachments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    club: Mapped["Club"] = relationship(back_populates="activities")

    __table_args__ = (
        Index("ix_club_activities_club_id", "club_id"),
        Index("ix_club_activities_activity_date", "activity_date"),
    )


class ClubSubmission(Base):
    """동아리 산출물 제출 (학생)"""
    __tablename__ = "club_submissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    club_id: Mapped[int] = mapped_column(
        ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    submission_type: Mapped[str] = mapped_column(
        String(30), nullable=False
    )  # report, code, data, presentation
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    club: Mapped["Club"] = relationship(back_populates="submissions")

    __table_args__ = (
        Index("ix_club_submissions_club_id", "club_id"),
        Index("ix_club_submissions_author_id", "author_id"),
    )
