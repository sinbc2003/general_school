"""Pydantic schemas — papers (논문/뉴스레터) 모듈."""

from typing import Literal

from pydantic import BaseModel, Field


PaperStatusStr = Literal["pending", "approved", "rejected", "published"]


class PaperStatusUpdate(BaseModel):
    status: PaperStatusStr


class KeywordCreate(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=200)
    category: str | None = None


class PaperNoteCreate(BaseModel):
    content: str
    page_number: int | None = None
    highlight_text: str | None = None
