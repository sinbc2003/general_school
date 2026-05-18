"""Pydantic schemas — contest 모듈."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ContestType = Literal["individual", "team"]
ContestStatusStr = Literal["upcoming", "active", "ended", "archived"]


class ContestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    contest_type: ContestType = "individual"
    rules: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_visible: bool = True
    semester_id: int | None = None  # 미지정 시 현재 학기


class ContestUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    contest_type: ContestType | None = None
    rules: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_visible: bool | None = None
    status: ContestStatusStr | None = None
    extra: dict | None = None


class ContestProblemCreate(BaseModel):
    """POST /api/contest/{cid}/problems"""
    problem_number: int = Field(..., ge=1)
    content: str = Field(..., min_length=1)
    answer: str | None = None
    points: int = Field(10, ge=0)


class ContestParticipantAdd(BaseModel):
    """POST /api/contest/{cid}/participants"""
    user_id: int


class ContestSubmissionCreate(BaseModel):
    """POST /api/contest/{cid}/submissions"""
    content: str | None = None
    file_path: str | None = None
