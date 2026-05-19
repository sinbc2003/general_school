"""Pydantic schemas — classroom_surveys 모듈."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


QuestionType = Literal[
    "short_text", "long_text", "single_choice", "multi_choice", "rating", "date",
]
SurveyStatus = Literal["draft", "active", "closed"]
AccessMode = Literal["course_members", "link_public"]


class SurveyCreate(BaseModel):
    """POST /api/classroom/surveys"""
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    course_id: int | None = None
    is_anonymous: bool = False
    allow_multiple_responses: bool = False
    access_mode: AccessMode = "course_members"
    response_edit_minutes: int = Field(0, ge=0, le=10080)  # 최대 1주(=10080분)


class SurveyUpdate(BaseModel):
    """PUT /api/classroom/surveys/{sid}"""
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    status: SurveyStatus | None = None
    is_anonymous: bool | None = None
    allow_multiple_responses: bool | None = None
    access_mode: AccessMode | None = None
    open_at: datetime | None = None
    close_at: datetime | None = None
    response_edit_minutes: int | None = Field(None, ge=0, le=10080)


class QuestionCreate(BaseModel):
    """POST /api/classroom/surveys/{sid}/questions"""
    question_text: str = Field(..., min_length=1)
    question_type: QuestionType
    is_required: bool = False
    options: list[str] | None = None
    rating_max: int = Field(5, ge=2, le=10)
    order: int | None = None  # 미지정 시 맨 끝

    @model_validator(mode="after")
    def _validate_options(self):
        if self.question_type in ("single_choice", "multi_choice"):
            if not self.options or len(self.options) < 2:
                raise ValueError("객관식·체크박스는 옵션 2개 이상 필요")
        return self


class QuestionUpdate(BaseModel):
    """PUT /api/classroom/surveys/questions/{qid}"""
    question_text: str | None = Field(None, min_length=1)
    question_type: QuestionType | None = None
    is_required: bool | None = None
    options: list[str] | None = None
    rating_max: int | None = Field(None, ge=2, le=10)
    order: int | None = None


class AnswerIn(BaseModel):
    """제출 시 한 질문에 대한 답변."""
    question_id: int
    text_value: str | None = None
    choice_values: list[str] | None = None
    rating_value: int | None = None


class ResponseSubmit(BaseModel):
    """POST /api/classroom/surveys/{sid}/responses"""
    answers: list[AnswerIn] = Field(..., min_length=1)
