"""Pydantic schemas — classroom_slides 모듈."""

from typing import Any, Literal

from pydantic import BaseModel, Field


AccessMode = Literal["course_members", "specific_users", "link_public"]
MemberRole = Literal["editor", "viewer"]


class PresentationCreate(BaseModel):
    """POST /api/classroom/decks"""
    title: str = Field("제목 없음 프리젠테이션", min_length=1, max_length=255)
    course_id: int | None = None
    access_mode: AccessMode = "course_members"


class PresentationUpdate(BaseModel):
    """PUT /api/classroom/decks/{did} — 메타데이터만. 본문은 Yjs WS."""
    title: str | None = Field(None, min_length=1, max_length=255)
    access_mode: AccessMode | None = None
    is_archived: bool | None = None
    settings: dict[str, Any] | None = None


class SlideCreate(BaseModel):
    """POST /api/classroom/decks/{did}/slides — 새 슬라이드 추가.

    order 미지정 시 deck 끝에 append.
    """
    title: str | None = Field(None, max_length=200)
    order: int | None = Field(None, ge=0)


class SlideUpdate(BaseModel):
    """PUT /api/classroom/slides/{sid} — 메타만."""
    title: str | None = Field(None, max_length=200)
    settings: dict[str, Any] | None = None


class SlideReorder(BaseModel):
    """POST /api/classroom/decks/{did}/slides/_reorder — 일괄 순서 변경."""
    order: list[int]  # slide_id list (앞에서부터 0, 1, 2, ...)


class PresentationMemberAdd(BaseModel):
    user_id: int
    role: MemberRole = "editor"


class DeckSnapshotIn(BaseModel):
    """POST /api/classroom/decks/{did}/yjs-snapshot — Hocuspocus 내부 호출."""
    state_base64: str = Field(..., min_length=1)
    plain_text: str | None = None  # 검색 인덱싱용 (전체 deck plaintext)
    created_by_id: int | None = None
