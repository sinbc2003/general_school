"""Pydantic schemas for announcement endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class AnnouncementCreate(BaseModel):
    """POST /api/announcements"""
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    audience: Literal["all", "staff"] = "all"
    is_pinned: bool = False


class AnnouncementUpdate(BaseModel):
    """PUT /api/announcements/{ann_id} — 부분 업데이트."""
    title: str | None = Field(None, min_length=1, max_length=200)
    body: str | None = Field(None, min_length=1)
    audience: Literal["all", "staff"] | None = None
    is_pinned: bool | None = None
