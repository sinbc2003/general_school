"""Pydantic schemas — 라이브 퀴즈."""

from typing import Any

from pydantic import BaseModel, Field


class QuizSessionCreate(BaseModel):
    """POST /api/tools/quiz/sessions"""
    problem_set_id: int
    settings: dict[str, Any] | None = None  # {time_per_question: 30, ...}


class QuizJoinReq(BaseModel):
    """POST /api/tools/quiz/join"""
    pin: str = Field(..., min_length=4, max_length=10)


class QuizAnswerReq(BaseModel):
    """POST /api/tools/quiz/play/{sid}/answer

    answer 형식은 코스웨어 submission과 동일:
      객관식 {"selected": ["A"]} / 단답 {"text": "..."} / 수치 {"value": 3.14}
    """
    answer: dict[str, Any]
