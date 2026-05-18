"""Pydantic schemas for pipeline endpoints."""

from pydantic import BaseModel, Field


class PipelineJobTrigger(BaseModel):
    """POST /api/pipeline/trigger"""
    job_type: str = Field(..., min_length=1, max_length=50)
    input_data: dict | None = None
    document_id: int | None = None


class PromptTemplateUpdate(BaseModel):
    """PUT /api/pipeline/prompts/{pid} — 부분 업데이트."""
    template: str | None = Field(None, min_length=1)
    is_active: bool | None = None
