"""Pydantic schemas — classroom 모듈."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


PostType = Literal["notice", "material", "assignment_ref"]
AttachmentType = Literal["link", "file", "doc", "survey", "sheet", "deck", "hwp"]


class Attachment(BaseModel):
    """글 첨부 항목. 다형 — type 별로 선택 필드.

    예: {type: "link", url: "https://...", title: "참고 자료"}
        {type: "doc", doc_id: 42, title: "프로젝트 노트"}
        {type: "sheet", sheet_id: 7, title: "성적"}
        {type: "deck", deck_id: 12, title: "1차 보고"}
        {type: "hwp", hwp_id: 5, title: "수업 자료"}
    """
    type: AttachmentType
    title: str = Field(..., min_length=1, max_length=255)
    url: str | None = None
    file_url: str | None = None
    file_name: str | None = None
    doc_id: int | None = None
    survey_id: int | None = None
    sheet_id: int | None = None
    deck_id: int | None = None
    hwp_id: int | None = None


class CourseCreate(BaseModel):
    """POST /api/classroom/courses — 강좌 수동 생성."""
    teacher_id: int
    subject: str = Field(..., min_length=1, max_length=100)
    class_name: str | None = Field(None, max_length=20, description="학급 단위 수업이면 '2-3', 선택과목은 null")
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    semester_id: int | None = None  # 미지정 시 현재 학기


class CourseUpdate(BaseModel):
    """PUT /api/classroom/courses/{cid} — 부분 업데이트."""
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    is_active: bool | None = None
    teacher_id: int | None = None


class CourseStudentAdd(BaseModel):
    """POST /api/classroom/courses/{cid}/students — 개별 학생 추가."""
    student_id: int


class CourseStudentBulk(BaseModel):
    """POST /api/classroom/courses/{cid}/students/bulk — 학번/이름 일괄 등록."""
    # student_number(int, 5자리 한국 학번) 또는 user_id 직접
    student_numbers: list[int] | None = None
    user_ids: list[int] | None = None


class CoursePostCreate(BaseModel):
    """POST /api/classroom/courses/{cid}/posts"""
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    post_type: PostType = "notice"
    is_pinned: bool = False
    # 과제 메타 (assignment_ref·자료에서 활용; 공지는 비워둠)
    due_date: datetime | None = None
    max_score: int | None = Field(None, ge=0, le=10000)
    topic: str | None = Field(None, max_length=100)
    attachments: list[Attachment] | None = None


class CoursePostUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    content: str | None = Field(None, min_length=1)
    post_type: PostType | None = None
    is_pinned: bool | None = None
    due_date: datetime | None = None
    max_score: int | None = Field(None, ge=0, le=10000)
    topic: str | None = Field(None, max_length=100)
    attachments: list[Attachment] | None = None


class AutoGenerateRequest(BaseModel):
    """POST /api/classroom/courses/_auto-generate

    학기 모든 교사 enrollment의 teaching_classes × teaching_subjects 조합으로
    강좌 자동 생성. 이미 존재하면 skip (멱등).
    """
    semester_id: int | None = None
    auto_enroll_students: bool = True  # 학급 단위 강좌면 자동 학생 등록
