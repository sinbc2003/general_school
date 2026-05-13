"""논문/뉴스레터 모델"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
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


class PaperStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    EXCLUDED = "excluded"


class NewsletterStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"


class Paper(Base):
    """크롤링된 논문"""
    __tablename__ = "papers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    arxiv_id: Mapped[str | None] = mapped_column(
        String(50), unique=True, nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    authors: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    translated_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    translated_abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    relevance_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    status: Mapped[PaperStatus] = mapped_column(
        Enum(PaperStatus), default=PaperStatus.PENDING, nullable=False
    )
    source: Mapped[str] = mapped_column(String(50), default="arxiv", nullable=False)
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    converted_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    published_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    crawled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_papers_status", "status"),
        Index("ix_papers_source", "source"),
        Index("ix_papers_relevance_score", "relevance_score"),
    )


class Newsletter(Base):
    """뉴스레터"""
    __tablename__ = "newsletters"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    issue_number: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    paper_ids: Mapped[list | None] = mapped_column(JSON, default=list, nullable=True)
    status: Mapped[NewsletterStatus] = mapped_column(
        Enum(NewsletterStatus), default=NewsletterStatus.DRAFT, nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_newsletters_status", "status"),
        Index("ix_newsletters_issue_number", "issue_number"),
    )


class CrawlKeyword(Base):
    """크롤링 키워드"""
    __tablename__ = "crawl_keywords"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    keyword: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PaperNote(Base):
    """논문 노트 (학생)"""
    __tablename__ = "paper_notes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    paper_id: Mapped[int] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    highlight_text: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_paper_notes_paper_id", "paper_id"),
        Index("ix_paper_notes_user_id", "user_id"),
    )
