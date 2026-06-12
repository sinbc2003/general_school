"""Pydantic schemas — 라이브 퀴즈."""

from typing import Any

from pydantic import BaseModel, Field


class QuizSessionCreate(BaseModel):
    """POST /api/tools/quiz/sessions"""
    problem_set_id: int
    settings: dict[str, Any] | None = None  # {time_per_question: 30, intro_seconds: 4}


class QuizQuestionIn(BaseModel):
    """직접 출제 문제 1개 (Kahoot식 — 객관식만, 정답 복수 허용)."""
    content: str = Field(..., min_length=1, max_length=2000)
    choices: list[str] = Field(..., min_length=2, max_length=6)
    correct: list[str] = Field(..., min_length=1)  # ["A", "C"] — 보기 letter
    image_url: str | None = Field(default=None, max_length=500)  # /storage/quiz/...


class QuizDirectCreate(BaseModel):
    """POST /api/tools/quiz/sessions/direct — 도구에서 직접 출제."""
    title: str = Field(..., min_length=1, max_length=255)
    questions: list[QuizQuestionIn] = Field(..., min_length=1, max_length=100)
    settings: dict[str, Any] | None = None


class QuizJoinReq(BaseModel):
    """POST /api/tools/quiz/join"""
    pin: str = Field(..., min_length=4, max_length=10)


class QuizAnswerReq(BaseModel):
    """POST /api/tools/quiz/play/{sid}/answer

    answer 형식은 코스웨어 submission과 동일:
      객관식 {"selected": ["A"]} / 단답 {"text": "..."} / 수치 {"value": 3.14}
    """
    answer: dict[str, Any]
