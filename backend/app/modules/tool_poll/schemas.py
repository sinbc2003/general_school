"""Pydantic schemas — 실시간 투표·워드클라우드."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class PollQuestionIn(BaseModel):
    """질문 1개.

    choice    : options 2~10개, multi=복수 선택 허용
    wordcloud : max_words = 1인당 단어 수 (1~5)
    id는 stable 키 — 편집 시 기존 id를 보내면 유지, 없으면 서버가 부여.
    """
    id: str | None = Field(default=None, max_length=50)
    type: Literal["choice", "wordcloud"]
    prompt: str = Field(..., min_length=1, max_length=500)
    options: list[str] = Field(default_factory=list, max_length=10)
    multi: bool = False
    max_words: int = Field(default=3, ge=1, le=5)


class PollCreate(BaseModel):
    """POST /api/tools/poll"""
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    questions: list[PollQuestionIn] = Field(..., min_length=1, max_length=50)


class PollUpdate(BaseModel):
    """PUT /api/tools/poll/{pid}"""
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    questions: list[PollQuestionIn] | None = Field(
        default=None, min_length=1, max_length=50,
    )


class PollSessionCreate(BaseModel):
    """POST /api/tools/poll/{pid}/sessions

    settings: {results_to_students: bool — 학생 기기에도 집계 표시 (default False)}
    """
    settings: dict[str, Any] | None = None


class PollGotoReq(BaseModel):
    """POST /api/tools/poll/sessions/{sid}/goto"""
    index: int = Field(..., ge=0)


class PollJoinReq(BaseModel):
    """POST /api/tools/poll/join"""
    pin: str = Field(..., min_length=4, max_length=10)


class PollRespondReq(BaseModel):
    """POST /api/tools/poll/play/{sid}/respond

    answer:
      choice    {"selected": ["A"]}
      wordcloud {"word": "텍스트"}
    """
    question_id: str = Field(..., min_length=1, max_length=50)
    answer: dict[str, Any]
