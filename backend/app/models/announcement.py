"""공지사항 모델 — 학교 전체/교직원 대상 공지"""

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
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AnnouncementAudience(str, enum.Enum):
    """공지 대상.

    - all   : 모든 사용자 (학생 포함) 열람 가능
    - staff : 교직원 (super_admin, designated_admin, teacher, staff) 만 열람
    """
    ALL = "all"
    STAFF = "staff"


class Announcement(Base):
    """공지사항 — 교사·관리자 작성, 학생/교직원 열람."""
    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[AnnouncementAudience] = mapped_column(
        Enum(AnnouncementAudience),
        default=AnnouncementAudience.ALL,
        nullable=False,
    )
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_announcements_audience", "audience"),
        Index("ix_announcements_pinned_created", "is_pinned", "created_at"),
        Index("ix_announcements_author_id", "author_id"),
    )
