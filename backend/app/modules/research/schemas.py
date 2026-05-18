"""Pydantic schemas — research 모듈."""

from typing import Literal

from pydantic import BaseModel, Field


ResearchType = Literal["individual", "team", "rne", "graduation", "external"]
ResearchStatus = Literal["proposed", "in_progress", "completed", "cancelled"]


class ResearchProjectCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    research_type: ResearchType = "individual"
    description: str | None = None
    advisor_id: int | None = None
    members: list | None = None
    year: int
    semester: int | None = None


class ResearchProjectUpdate(BaseModel):
    title: str | None = None
    research_type: ResearchType | None = None
    description: str | None = None
    advisor_id: int | None = None
    members: list | None = None
    status: ResearchStatus | None = None
    milestones: list | None = None


class ResearchLogCreate(BaseModel):
    """POST /api/research/{pid}/logs"""
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    log_type: str = Field("progress", max_length=30)


class ResearchJournalCreate(BaseModel):
    """POST /api/research/{pid}/journals"""
    content: str = Field(..., min_length=1)
    week_number: int = Field(..., ge=1, le=200)
