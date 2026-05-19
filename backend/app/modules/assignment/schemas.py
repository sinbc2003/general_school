"""Pydantic schemas — assignment 모듈."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


SubmissionFormat = Literal["pdf", "image", "text", "file"]
AssignmentStatusStr = Literal["draft", "active", "closed"]
SubmissionStatusStr = Literal["submitted", "late", "reviewed", "rejected", "accepted"]


class AssignmentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    subject: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    target_grades: list[int] | None = None
    due_date: datetime
    submission_format: SubmissionFormat = "pdf"
    is_visible: bool = True
    semester_id: int | None = None
    # 파일명 정규화 템플릿 (예: "{grade}-{class}_{number}_{name}_{original}")
    # 학생 업로드 시 자동 적용. None이면 원본 그대로.
    filename_template: str | None = Field(None, max_length=255)


class AssignmentUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    subject: str | None = None
    description: str | None = None
    target_grades: list[int] | None = None
    due_date: datetime | None = None
    submission_format: SubmissionFormat | None = None
    is_visible: bool | None = None
    status: AssignmentStatusStr | None = None
    filename_template: str | None = Field(None, max_length=255)


class FilenamePreviewRequest(BaseModel):
    """패턴 미리보기 — frontend 패턴 입력 중 실시간 검증/표시용."""
    pattern: str = Field(..., min_length=1, max_length=255)


class SubmissionReview(BaseModel):
    status: SubmissionStatusStr = "reviewed"
    review_comment: str | None = None
