"""Pydantic schemas — archive 모듈."""

from typing import Literal

from pydantic import BaseModel, Field


class ProblemCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str
    answer: str | None = None
    difficulty: int | None = Field(None, ge=1, le=5)
    subject: str | None = None
    grade_semester: str | None = None  # "2-1" 등
    year: int | None = None
    tags: list[str] | None = None
    extra: dict | None = None


class ProblemUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    answer: str | None = None
    difficulty: int | None = Field(None, ge=1, le=5)
    subject: str | None = None
    grade_semester: str | None = None
    year: int | None = None
    tags: list[str] | None = None
    extra: dict | None = None
    review_status: Literal["pending", "approved", "rejected"] | None = None
    is_visible: bool | None = None
