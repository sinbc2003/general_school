"""Pydantic schemas for portfolio endpoints."""

from datetime import date

from pydantic import BaseModel, Field


class GradeCreate(BaseModel):
    """POST /api/students/{sid}/grades"""
    year: int = Field(..., ge=2000, le=2100)
    semester: int = Field(..., ge=1, le=4)
    exam_type: str = Field(..., min_length=1, max_length=20)
    subject: str = Field(..., min_length=1, max_length=100)
    score: float = Field(..., ge=0)
    max_score: float = Field(100.0, gt=0)
    grade_rank: int | None = Field(None, ge=1)
    class_rank: int | None = Field(None, ge=1)
    total_students: int | None = Field(None, ge=1)
    average: float | None = Field(None, ge=0)
    standard_deviation: float | None = Field(None, ge=0)
    comment: str | None = None


class MockExamCreate(BaseModel):
    """POST /api/students/{sid}/mock-exams"""
    exam_name: str = Field(..., min_length=1, max_length=200)
    exam_date: date
    subject: str = Field(..., min_length=1, max_length=100)
    raw_score: float = Field(..., ge=0)
    standard_score: float | None = Field(None, ge=0)
    percentile: float | None = Field(None, ge=0, le=100)
    grade_level: int | None = Field(None, ge=1, le=9)


class AwardCreate(BaseModel):
    """POST /api/students/{sid}/awards"""
    title: str = Field(..., min_length=1, max_length=255)
    award_type: str = Field(..., min_length=1, max_length=50)
    category: str = Field(..., min_length=1, max_length=100)
    award_level: str = Field(..., min_length=1, max_length=50)
    award_date: date
    organizer: str | None = Field(None, max_length=200)
    description: str | None = None


class ThesisCreate(BaseModel):
    """POST /api/students/{sid}/theses"""
    title: str = Field(..., min_length=1, max_length=500)
    thesis_type: str = Field(..., min_length=1, max_length=50)
    abstract: str | None = None
    advisor_id: int | None = None
    coauthors: list[str] | None = None
    journal: str | None = Field(None, max_length=200)
    status: str = Field("in_progress", max_length=30)


class CounselingCreate(BaseModel):
    """POST /api/students/{sid}/counselings"""
    counseling_date: date
    counseling_type: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    follow_up: str | None = None


class RecordCreate(BaseModel):
    """POST /api/students/{sid}/records"""
    year: int = Field(..., ge=2000, le=2100)
    semester: int = Field(..., ge=1, le=4)
    record_type: str = Field(..., min_length=1, max_length=50)
    content: str = Field(..., min_length=1)
