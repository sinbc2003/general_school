"""Pydantic schemas — 자리배치.

layout/roster/constraints/assignment은 프런트 편집기가 점진적으로 채우는
구조라 관용적으로 받되, 핵심 필드는 타입을 명시한다.
"""

from typing import Any

from pydantic import BaseModel, Field


class DeskIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=40)
    row: int = Field(..., ge=0, le=49)
    col: int = Field(..., ge=0, le=49)
    seats: int = Field(default=2, ge=1, le=2)


class LayoutIn(BaseModel):
    rows: int = Field(default=5, ge=1, le=20)
    cols: int = Field(default=6, ge=1, le=20)
    desks: list[DeskIn] = Field(default_factory=list, max_length=400)
    aisles: list[int] = Field(default_factory=list, max_length=20)
    podium: dict[str, Any] | None = None
    board: str = Field(default="front", max_length=20)
    doors: list[dict[str, Any]] = Field(default_factory=list, max_length=8)
    facing: str = Field(default="front", max_length=20)


class RosterEntryIn(BaseModel):
    key: str = Field(..., min_length=1, max_length=40)
    name: str = Field(..., min_length=1, max_length=100)
    number: int | None = Field(default=None, ge=0, le=99)
    student_number: int | None = None
    user_id: int | None = None


class ConstraintsIn(BaseModel):
    forbidden_pairs: list[list[str]] = Field(default_factory=list, max_length=400)
    keep_together: list[list[str]] = Field(default_factory=list, max_length=200)
    alone: list[str] = Field(default_factory=list, max_length=400)
    fixed: dict[str, str] = Field(default_factory=dict)
    excluded: list[str] = Field(default_factory=list, max_length=400)


class SeatingCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    layout: LayoutIn | None = None
    roster: list[RosterEntryIn] | None = Field(default=None, max_length=400)
    constraints: ConstraintsIn | None = None
    assignment: dict[str, str] | None = None


class SeatingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    layout: LayoutIn | None = None
    roster: list[RosterEntryIn] | None = Field(default=None, max_length=400)
    constraints: ConstraintsIn | None = None
    assignment: dict[str, str] | None = None


class ShuffleReq(BaseModel):
    """POST /api/tools/seating/{id}/shuffle

    seed: 재현용(테스트). save: 결과를 즉시 저장.
    keep_fixed가 false면 고정 자리도 무시하고 전원 재배치.
    """
    seed: int | None = None
    save: bool = True
    keep_fixed: bool = True
