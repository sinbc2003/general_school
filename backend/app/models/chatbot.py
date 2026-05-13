"""챗봇 (LLM) 관련 모델

설계:
- LLMProvider: provider별 API 키 (Fernet 암호화)
- LLMModel: provider별 사용 가능 모델 + 단가 (관리자가 수정 가능)
- SystemPrompt: 시스템 프롬프트 템플릿 (audience별)
- ChatSession: 사용자별 대화 세션 (영구 보존)
- ChatMessage: 메시지 (역할/내용/토큰/비용)
- ChatUsageDaily: 일별 사용량 집계 (대시보드용)
- ChatbotConfig: 챗봇 전역 설정 (기본 모델 등)
"""

from datetime import datetime, date

from sqlalchemy import (
    Boolean, DateTime, Date, Float, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class LLMProvider(Base):
    """LLM provider별 API 키 등록 (provider당 1행)"""
    __tablename__ = "llm_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # "openai" | "anthropic" | "google"
    provider: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_test_ok: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_test_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class LLMModel(Base):
    """provider별 사용 가능 모델 + 단가 (USD per 1M tokens)"""
    __tablename__ = "llm_models"
    __table_args__ = (UniqueConstraint("provider", "model_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    model_id: Mapped[str] = mapped_column(String(150), nullable=False)  # API 호출용
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    input_per_1m_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    output_per_1m_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    context_window: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SystemPrompt(Base):
    """시스템 프롬프트 템플릿"""
    __tablename__ = "llm_system_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # "teacher" | "student" | "both"
    audience: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChatSession(Base):
    """대화 세션 (영구 보존)"""
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), default="새 대화", nullable=False)
    # 사용자 role 기반 자동 ("teacher" | "student" | "admin")
    audience: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model_id: Mapped[str] = mapped_column(String(150), nullable=False)
    system_prompt_id: Mapped[int | None] = mapped_column(
        ForeignKey("llm_system_prompts.id", ondelete="SET NULL"), nullable=True
    )
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )

    __table_args__ = (
        Index("ix_chat_sessions_user_archived", "user_id", "archived"),
    )


class ChatMessage(Base):
    """챗 메시지"""
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "user" | "assistant" | "system"
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # assistant 응답인 경우 어느 모델/provider로 생성됐는지 스냅샷
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped["ChatSession"] = relationship(back_populates="messages")


class ChatUsageDaily(Base):
    """일별 사용량 집계 (사용자×일×provider×model)"""
    __tablename__ = "chat_usage_daily"
    __table_args__ = (
        UniqueConstraint("user_id", "usage_date", "provider", "model_id"),
        Index("ix_chat_usage_daily_date", "usage_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    usage_date: Mapped[date] = mapped_column(Date, nullable=False)
    provider: Mapped[str] = mapped_column(String(30), nullable=False)
    model_id: Mapped[str] = mapped_column(String(150), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChatbotConfig(Base):
    """챗봇 전역 설정 — 키/값 (관리자가 UI에서 변경)

    주요 키:
      default_provider_teacher, default_model_teacher
      default_provider_student, default_model_student
      student_can_change_model ("true"|"false")
      teacher_can_change_model ("true"|"false")
      student_can_pick_prompt ("true"|"false")
      max_message_length (int as str)
      max_session_messages (int as str)
    """
    __tablename__ = "chatbot_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
