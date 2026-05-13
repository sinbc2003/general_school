"""AI 개발자 요청/응답 스키마"""

from datetime import datetime
from pydantic import BaseModel, Field


class DevRequestCreate(BaseModel):
    feedback_id: int | None = Field(None)
    title: str = Field(..., max_length=255)
    prompt: str = Field(..., min_length=10, max_length=10000)
    request_type: str = Field("feature", pattern=r"^(feature|bugfix|ui_change|config_change)$")


class DevRequestExecute(BaseModel):
    additional_context: str | None = Field(None, max_length=5000)
    model: str | None = Field(None)


class DevRequestApply(BaseModel):
    action: str = Field(..., pattern=r"^(approve|reject)$")
    note: str | None = Field(None, max_length=2000)


class DevRequestResponse(BaseModel):
    id: int
    feedback_id: int | None
    title: str
    prompt: str
    request_type: str
    status: str
    created_by_id: int | None
    used_model: str | None
    ai_response: str | None
    file_changes: list[dict] | None
    error_message: str | None
    admin_note: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DevRequestListResponse(BaseModel):
    items: list[DevRequestResponse]
    total: int
