"""Pydantic schemas — 단어장."""

from pydantic import BaseModel, Field


class DeckCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    lang_pair: str = Field(default="en-ko", max_length=20)
    is_public: bool = False


class DeckUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    lang_pair: str | None = Field(default=None, max_length=20)
    is_public: bool | None = None


class CardIn(BaseModel):
    term: str = Field(..., min_length=1, max_length=255)
    meaning: str = Field(..., min_length=1, max_length=500)
    example: str | None = Field(default=None, max_length=2000)


class CardUpdate(BaseModel):
    term: str | None = Field(default=None, min_length=1, max_length=255)
    meaning: str | None = Field(default=None, min_length=1, max_length=500)
    example: str | None = Field(default=None, max_length=2000)


class CardsBulkIn(BaseModel):
    """일괄 추가 — CSV 파싱 결과 또는 붙여넣기."""
    items: list[CardIn] = Field(default_factory=list, max_length=2000)


class ProgressIn(BaseModel):
    """학습 결과 1건 — 라이트너 박스 갱신."""
    card_id: int = Field(..., gt=0)
    correct: bool
