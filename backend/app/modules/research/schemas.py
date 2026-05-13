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
