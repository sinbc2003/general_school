"""Pydantic schemas — papers (논문/뉴스레터) 모듈."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class KeywordCreate(BaseModel):
    keyword: str = Field(..., min_length=1, max_length=200)
    category: str | None = None
    is_active: bool = True


class KeywordUpdate(BaseModel):
    keyword: str | None = None
    category: str | None = None
    is_active: bool | None = None


class PaperApprove(BaseModel):
    approved: bool = True
    comment: str | None = None


class NewsletterCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    issue_date: date
    content: str
    paper_ids: list[int] | None = None


class PaperNoteCreate(BaseModel):
    paper_id: int
    content: str
    is_public: bool = False
