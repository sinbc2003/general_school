"""피드백 모델 — 건의사항, AI 개발요청"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Feedback(Base):
    """건의사항 및 오류 신고"""
    __tablename__ = "feedbacks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    feedback_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # bug, feature, other
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(50), default="pending", nullable=False
    )  # pending, in_progress, resolved, dismissed
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    dev_requests: Mapped[list["DevRequest"]] = relationship(
        back_populates="feedback", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_feedbacks_user_id", "user_id"),
        Index("ix_feedbacks_status", "status"),
        Index("ix_feedbacks_created_at", "created_at"),
    )


class DevRequest(Base):
    """AI 개발자 요청"""
    __tablename__ = "dev_requests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feedback_id: Mapped[int | None] = mapped_column(
        ForeignKey("feedbacks.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    request_type: Mapped[str] = mapped_column(
        String(50), default="feature", nullable=False
    )  # feature, bugfix, ui_change, config_change
    status: Mapped[str] = mapped_column(
        String(50), default="draft", nullable=False
    )  # draft, generating, generated, approved, applied, rejected, failed
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    used_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ai_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_changes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    feedback: Mapped["Feedback | None"] = relationship(back_populates="dev_requests")

    __table_args__ = (
        Index("ix_dev_requests_status", "status"),
        Index("ix_dev_requests_feedback_id", "feedback_id"),
        Index("ix_dev_requests_created_at", "created_at"),
    )
