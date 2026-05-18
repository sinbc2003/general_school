"""Pydantic schemas for challenge endpoints."""

from pydantic import BaseModel, Field


class ChallengeLevelCreate(BaseModel):
    """POST /api/challenge/levels"""
    category: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=200)
    level_number: int = Field(..., ge=1)
    unlock_threshold: int = Field(70, ge=0, le=100)


class ChallengeProblemCreate(BaseModel):
    """POST /api/challenge/levels/{lid}/problems"""
    content: str = Field(..., min_length=1)
    solution: str | None = None
    difficulty: str = Field(..., min_length=1, max_length=30)
    source_name: str | None = Field(None, max_length=200)
    order: int = Field(0, ge=0)
    points: int = Field(10, ge=0)


class ChallengeSolveSubmit(BaseModel):
    """POST /api/challenge/problems/{pid}/solve"""
    status: str = Field("completed", max_length=30)
    score: int = Field(0, ge=0)
