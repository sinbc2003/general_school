"""Past research 스키마."""

from pydantic import BaseModel, Field


class PastResearchItem(BaseModel):
    id: int
    year: int
    grade: int | None = None
    semester: int | None = None
    report_type: str | None = None
    fields: list[str] = []
    title: str
    is_excellent: bool = False
    original_filename: str
    file_size: int = 0
    file_url: str
    status: str = "approved"
    submitted_by_student_id: int | None = None
    submitted_by_name: str | None = None
    supervisor_id: int | None = None
    rejection_reason: str | None = None
    created_at: str | None = None


class PastResearchListResponse(BaseModel):
    items: list[PastResearchItem]
    total: int
    page: int
    page_size: int


class BulkUploadResult(BaseModel):
    success: int
    skipped: list[dict]
    failed: list[dict]


# ── 학생 자가 업로드 ──

class StudentSubmitMeta(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    grade: int = Field(..., ge=1, le=6)
    semester: int = Field(..., ge=1, le=2)
    report_type: str = Field(..., min_length=1, max_length=64)
    fields: list[str] = Field(..., min_length=1)
    title: str = Field(..., min_length=1, max_length=400)
    is_excellent: bool = False


class ReviewReq(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    rejection_reason: str | None = Field(None, max_length=500)


# ── 담당교사 매핑 ──

class SupervisionCreate(BaseModel):
    semester_id: int
    student_id: int
    supervisor_id: int
    topic_title: str | None = Field(None, max_length=300)
    note: str | None = None


class SupervisionItem(BaseModel):
    id: int
    semester_id: int
    student_id: int
    student_name: str | None = None
    student_username: str | None = None
    supervisor_id: int
    supervisor_name: str | None = None
    topic_title: str | None = None
    note: str | None = None
    created_at: str | None = None
