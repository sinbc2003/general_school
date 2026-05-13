"""Pydantic schemas — archive 모듈 (Problem CRUD)."""

from typing import Literal

from pydantic import BaseModel, Field


class ProblemCreate(BaseModel):
    department: str = "math"
    subject: str = Field(..., min_length=1)
    difficulty: int = Field(..., ge=1, le=5)
    question_type: str
    content: str
    solution: str | None = None
    answer: str | None = None
    grade_semester: str | None = None  # "2-1" 등
    year: int | None = None
    tags: list[str] | None = None
    extra: dict | None = None


class ProblemUpdate(BaseModel):
    department: str | None = None
    subject: str | None = None
    difficulty: int | None = Field(None, ge=1, le=5)
    question_type: str | None = None
    content: str | None = None
    solution: str | None = None
    answer: str | None = None
    grade_semester: str | None = None
    year: int | None = None
    tags: list[str] | None = None
    extra: dict | None = None
    review_status: Literal["pending", "approved", "rejected"] | None = None
    is_visible: bool | None = None
