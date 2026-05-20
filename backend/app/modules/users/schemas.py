from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: str
    name: str
    role: str = "student"
    password: str | None = None
    username: str | None = None
    grade: int | None = None
    class_number: int | None = None
    student_number: int | None = None
    department: str | None = None
    # 확장 필드 (Phase 1.0)
    department_id: int | None = None
    is_grade_lead: bool = False
    lead_grade: int | None = None
    user_type: str = "regular"
    expires_at: str | None = None  # ISO datetime string
    phone: str | None = None
    google_email: str | None = None
    lifecycle_status: str = "active"


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    status: str | None = None
    grade: int | None = None
    class_number: int | None = None
    student_number: int | None = None
    department: str | None = None
    # 확장 필드
    department_id: int | None = None
    is_grade_lead: bool | None = None
    lead_grade: int | None = None
    user_type: str | None = None
    expires_at: str | None = None
    phone: str | None = None
    google_email: str | None = None
    lifecycle_status: str | None = None
    # quota (MB 단위 입력 받아서 bytes로 환산)
    quota_mb: int | None = None


class QuotaUpdate(BaseModel):
    """POST /api/users/{id}/quota — quota 변경 전용."""
    quota_mb: int  # 0 = 무제한 (super_admin)


class QuotaBulkUpdate(BaseModel):
    """POST /api/users/_quota/bulk — 역할별 일괄 quota 변경."""
    role: str
    quota_mb: int


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    username: str | None
    role: str
    status: str
    grade: int | None
    class_number: int | None
    student_number: int | None
    department: str | None
    department_id: int | None = None
    is_grade_lead: bool = False
    lead_grade: int | None = None
    user_type: str = "regular"
    expires_at: str | None = None
    phone: str | None = None
    google_email: str | None = None
    lifecycle_status: str = "active"
    quota_bytes: int = 0
    used_bytes: int = 0
    totp_enabled: bool
    must_change_password: bool
    created_at: str | None


class BulkValidationResult(BaseModel):
    valid_count: int
    error_count: int
    errors: list[dict]
    preview: list[dict]


class BulkImportResult(BaseModel):
    created: int
    skipped: int


class CohortPromoteRequest(BaseModel):
    """POST /api/users/_cohort/promote — 학년 일괄 진급."""
    from_grade: int
    to_grade: int
    dry_run: bool = False


class CohortGraduateRequest(BaseModel):
    """POST /api/users/_cohort/graduate — 졸업 처리."""
    graduation_year: int
    ids: list[int] | None = None
    from_grade: int | None = 3
    dry_run: bool = False
