"""교사 임시 그룹 스키마."""

from pydantic import BaseModel, Field


class GroupCreate(BaseModel):
    semester_id: int
    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field("event", pattern="^(event|contest|research|etc)$")
    description: str | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    type: str | None = Field(None, pattern="^(event|contest|research|etc)$")
    description: str | None = None
    is_active: bool | None = None


class MemberAdd(BaseModel):
    teacher_id: int
    role: str = Field("member", pattern="^(leader|member)$")


class StudentAssign(BaseModel):
    student_id: int
    note: str | None = None


class StudentAssignByUsername(BaseModel):
    username: str = Field(..., min_length=1)
    note: str | None = None


class SubmissionReviewReq(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    rejection_reason: str | None = Field(None, max_length=500)
