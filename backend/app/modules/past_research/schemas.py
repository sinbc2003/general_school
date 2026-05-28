"""Past research 스키마."""

from pydantic import BaseModel


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
