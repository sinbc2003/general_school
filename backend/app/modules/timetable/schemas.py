"""Pydantic schemas — 시간표/학기/명단 모듈.

dict 기반 요청을 점진적으로 schema 기반으로 마이그레이션.
schema 정의 = 입력 검증 + OpenAPI 자동 문서화 + IDE 자동완성.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# ── Semester ──

class SemesterCreate(BaseModel):
    """학기 생성 요청."""
    year: int = Field(..., ge=2000, le=2100)
    semester: Literal[1, 2]
    name: str | None = None
    start_date: date
    end_date: date
    is_current: bool = False

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v: date, info):
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


class SemesterUpdate(BaseModel):
    """학기 부분 수정."""
    year: int | None = Field(None, ge=2000, le=2100)
    semester: Literal[1, 2] | None = None
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class SemesterStructureUpdate(BaseModel):
    """학기별 학교 구조 (드롭다운 표준화 소스)."""
    classes_per_grade: dict[str, int] | None = None
    subjects: list[str] | None = None
    departments: list[str] | None = None


# ── Enrollment ──

EnrollmentRole = Literal["teacher", "staff", "student"]
EnrollmentStatus = Literal["active", "transferred", "graduated", "on_leave"]


class EnrollmentCreate(BaseModel):
    """학기별 명단 등록."""
    user_id: int
    role: EnrollmentRole | None = None  # 미지정 시 user.role 사용
    status: EnrollmentStatus = "active"
    grade: int | None = None
    class_number: int | None = None
    student_number: int | None = None
    department: str | None = None
    position: str | None = None
    homeroom_class: str | None = None
    subhomeroom_class: str | None = None
    teaching_grades: list[int] | str | None = None  # list or "1,2" 문자열
    teaching_classes: list[str] | str | None = None
    teaching_subjects: list[str] | str | None = None
    phone: str | None = None
    note: str | None = None


class EnrollmentUpdate(BaseModel):
    """명단 부분 수정. 인라인 편집에서 단일 필드 PATCH도 처리."""
    role: EnrollmentRole | None = None
    status: EnrollmentStatus | None = None
    grade: int | None = None
    class_number: int | None = None
    student_number: int | None = None
    department: str | None = None
    position: str | None = None
    homeroom_class: str | None = None
    subhomeroom_class: str | None = None
    teaching_grades: list[int] | str | None = None
    teaching_classes: list[str] | str | None = None
    teaching_subjects: list[str] | str | None = None
    phone: str | None = None
    note: str | None = None


class OnboardingSubmit(BaseModel):
    """교사 onboarding — 본인 명단 정보 입력."""
    semester_id: int | None = None
    homeroom_class: str | None = None
    subhomeroom_class: str | None = None
    teaching_grades: list[int] = []
    teaching_classes: list[str] = []
    teaching_subjects: list[str] = []
    phone: str | None = None


class PromoteRequest(BaseModel):
    """진급/명단 복제 마법사."""
    promote_students: bool = True
    graduate_grade: int | None = 3
    copy_teachers: bool = True
    dry_run: bool = False
