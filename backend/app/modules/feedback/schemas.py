"""Pydantic schemas for feedback endpoints."""

from pydantic import BaseModel, Field


class FeedbackCreate(BaseModel):
    """POST /api/feedback"""
    feedback_type: str = Field(..., min_length=1, max_length=30)
    content: str = Field(..., min_length=1)
    page_url: str | None = Field(None, max_length=500)


class FeedbackStatusUpdate(BaseModel):
    """PATCH /api/feedback/{fid} — 관리자만, 부분 업데이트."""
    status: str | None = Field(None, max_length=30)
    admin_note: str | None = None
