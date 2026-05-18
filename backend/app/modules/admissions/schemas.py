"""Pydantic schemas for admissions endpoints."""

from pydantic import BaseModel, Field


class AdmissionsQuestionCreate(BaseModel):
    """POST /api/admissions/questions"""
    university: str = Field(..., min_length=1, max_length=100)
    department: str | None = Field(None, max_length=100)
    admission_type: str = Field(..., min_length=1, max_length=50)
    question_type: str = Field(..., min_length=1, max_length=50)
    year: int = Field(..., ge=1900, le=2100)
    content: str = Field(..., min_length=1)
    solution: str | None = None
    subject: str | None = Field(None, max_length=100)
    tags: list[str] | None = None


class AdmissionsQuestionUpdate(BaseModel):
    """PUT /api/admissions/questions/{qid} — 부분 업데이트."""
    university: str | None = Field(None, min_length=1, max_length=100)
    department: str | None = Field(None, max_length=100)
    admission_type: str | None = Field(None, min_length=1, max_length=50)
    question_type: str | None = Field(None, min_length=1, max_length=50)
    year: int | None = Field(None, ge=1900, le=2100)
    content: str | None = Field(None, min_length=1)
    solution: str | None = None
    subject: str | None = Field(None, max_length=100)
    tags: list[str] | None = None


class AdmissionsRecordCreate(BaseModel):
    """POST /api/admissions/records"""
    student_id: int
    graduation_year: int = Field(..., ge=1900, le=2100)
    results: dict | list | None = None  # 자유형식 JSON
    portfolio_summary: str | None = None


class AdmissionsResponseSubmit(BaseModel):
    """POST /api/admissions/questions/{qid}/respond"""
    response: str = Field(..., min_length=1)
