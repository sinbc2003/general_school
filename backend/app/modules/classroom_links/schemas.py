"""Pydantic schemas — classroom_links 모듈."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


TargetType = Literal["survey", "document"]


class ShortLinkCreate(BaseModel):
    """POST /api/classroom/links — 단축 링크 생성."""
    target_type: TargetType
    target_id: int = Field(..., gt=0)
    expires_at: datetime | None = None
