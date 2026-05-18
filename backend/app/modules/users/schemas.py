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


class UserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    status: str | None = None
    grade: int | None = None
    class_number: int | None = None
    student_number: int | None = None
    department: str | None = None


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
