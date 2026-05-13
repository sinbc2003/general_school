"""Pydantic schemas — club 모듈."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class ClubCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    advisor_id: int | None = None
    members: list | None = None
    year: int | None = None  # 미지정 시 학기에서 추출
    budget: int | None = None
    semester_id: int | None = None


class ClubUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    members: list | None = None
    status: Literal["active", "inactive", "suspended"] | None = None
    budget: int | None = None


class ClubActivityCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str
    activity_date: date
    attendees: list | None = None


class ClubSubmissionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    submission_type: Literal["report", "code", "data", "presentation"]
    file_path: str | None = None
