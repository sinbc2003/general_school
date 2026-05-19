"""Pydantic schemas — classroom_docs 모듈."""

from typing import Literal

from pydantic import BaseModel, Field


AccessMode = Literal["course_members", "specific_users", "link_public"]
MemberRole = Literal["editor", "viewer"]


class DocumentCreate(BaseModel):
    """POST /api/classroom/docs"""
    title: str = Field("제목 없음", min_length=1, max_length=255)
    course_id: int | None = None  # null이면 단독 문서
    access_mode: AccessMode = "course_members"


class DocumentUpdate(BaseModel):
    """PUT /api/classroom/docs/{did} — 메타데이터만. 본문 편집은 Yjs WS."""
    title: str | None = Field(None, min_length=1, max_length=255)
    access_mode: AccessMode | None = None
    is_archived: bool | None = None


class DocumentMemberAdd(BaseModel):
    """POST /api/classroom/docs/{did}/members"""
    user_id: int
    role: MemberRole = "editor"


class DocumentSnapshotIn(BaseModel):
    """POST /api/classroom/docs/{did}/yjs-snapshot — Hocuspocus 내부 호출.

    state_base64: Y.encodeStateAsUpdate 결과를 base64로 인코딩한 문자열.
    plain_text: Yjs CRDT → 검색용 텍스트 (Hocuspocus가 추출).
    created_by_id: 마지막 편집자 (옵션 — anonymous면 null).
    """
    state_base64: str = Field(..., min_length=1)
    plain_text: str | None = None
    created_by_id: int | None = None
