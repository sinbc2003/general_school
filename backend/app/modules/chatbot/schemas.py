"""Pydantic schemas for chatbot admin endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class ProviderUpsert(BaseModel):
    """PUT /api/chatbot/providers/{provider}"""
    api_key: str | None = None
    is_active: bool | None = None
    notes: str | None = None
    default_model_id: str | None = None


class ModelCreate(BaseModel):
    """POST /api/chatbot/models"""
    provider: str = Field(..., min_length=1)
    model_id: str = Field(..., min_length=1)
    display_name: str | None = None
    input_price_per_1m_usd: float | None = Field(None, ge=0)
    output_price_per_1m_usd: float | None = Field(None, ge=0)
    context_window: int | None = Field(None, gt=0)
    is_active: bool = True
    sort_order: int = 100
    tool_ai_enabled: bool = False


class ModelUpdate(BaseModel):
    """PUT /api/chatbot/models/{mid} — 부분 업데이트."""
    display_name: str | None = None
    input_price_per_1m_usd: float | None = Field(None, ge=0)
    output_price_per_1m_usd: float | None = Field(None, ge=0)
    context_window: int | None = Field(None, gt=0)
    is_active: bool | None = None
    sort_order: int | None = None
    tool_ai_enabled: bool | None = None


class PromptCreate(BaseModel):
    """POST /api/chatbot/prompts"""
    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    audience: Literal["teacher", "student", "both"] = "both"
    is_default: bool = False


class PromptUpdate(BaseModel):
    """PUT /api/chatbot/prompts/{pid}"""
    name: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1)
    audience: Literal["teacher", "student", "both"] | None = None
    is_default: bool | None = None


class ChatbotConfigUpdate(BaseModel):
    """PUT /api/chatbot/config — 부분 업데이트.

    free-form key/value dict. 각 키별 검증은 라우터에서.
    """
    teacher_default_provider: str | None = None
    teacher_default_model_id: str | None = None
    teacher_default_prompt_id: int | None = None
    student_default_provider: str | None = None
    student_default_model_id: str | None = None
    student_default_prompt_id: int | None = None
    student_can_change_model: bool | None = None
    student_can_change_prompt: bool | None = None
    max_messages_per_session: int | None = Field(None, gt=0)
    max_sessions_per_user: int | None = Field(None, gt=0)


class ChatSessionCreate(BaseModel):
    """POST /api/chatbot/sessions"""
    provider: str | None = None
    model_id: str | None = None
    system_prompt_id: int | None = None
    title: str | None = Field(None, max_length=300)


class ChatSessionUpdate(BaseModel):
    """PATCH /api/chatbot/sessions/{sid} — 부분 업데이트."""
    title: str | None = Field(None, max_length=300)
    pinned: bool | None = None
    archived: bool | None = None
    provider: str | None = None
    model_id: str | None = None
    system_prompt_id: int | None = None


class ChatStreamRequest(BaseModel):
    """POST /api/chatbot/sessions/{sid}/stream"""
    content: str = Field(..., min_length=1)
