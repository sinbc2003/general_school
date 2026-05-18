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
    # 이전 학기에서 복사할 항목들 (1학기 → 2학기 등). None이면 빈 학기로 생성.
    copy_from_semester_id: int | None = None
    copy_enrollments: bool = True   # 학생/교사 명단
    copy_clubs: bool = True          # 동아리 + members
    copy_structure: bool = True      # classes_per_grade, subjects, departments
    # 학기별 직책 매핑(EnrollmentPosition) 복사 여부.
    # 운영 시나리오: 업무분장은 학년도 단위 → 1학기→2학기는 그대로 가져오는 게 일반적
    #            (간혹 중간 변경은 명시적 수정으로 처리).
    # 디폴트 True. 새 학년도(1→다음 1학기)에서는 운영자가 명시적으로 False 선택 권장.
    copy_positions: bool = True

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


# ── 시간표 항목 (Entry) ──

EntryType = Literal["class", "meeting", "consultation", "event", "other"]


class TimetableEntryCreate(BaseModel):
    """POST /api/timetable/entries"""
    semester_id: int = Field(..., gt=0)
    teacher_id: int = Field(..., gt=0)
    day_of_week: int = Field(..., ge=0, le=6)
    period: int = Field(..., ge=1, le=20)
    subject: str = Field(..., min_length=1, max_length=100)
    class_name: str = Field(..., min_length=1, max_length=50)
    room: str | None = Field(None, max_length=50)


class TimetableEntryUpdate(BaseModel):
    """PUT /api/timetable/entries/{eid} — 부분 업데이트.

    super_admin/designated_admin은 모든 필드 수정.
    teacher (본인 entry)는 subject/class_name/room/note만.
    """
    subject: str | None = Field(None, max_length=100)
    class_name: str | None = Field(None, max_length=50)
    room: str | None = Field(None, max_length=50)
    note: str | None = Field(None, max_length=255)
    # admin only
    day_of_week: int | None = Field(None, ge=0, le=6)
    period: int | None = Field(None, ge=1, le=20)
    teacher_id: int | None = Field(None, gt=0)
    entry_type: EntryType | None = None


class TimetableEntryBulkCreate(BaseModel):
    """POST /api/timetable/entries/bulk — 일괄 생성."""
    entries: list[TimetableEntryCreate] = Field(default_factory=list)


class MyEventCreate(BaseModel):
    """POST /api/timetable/my-events — 본인 개인 일정.

    entry_type은 'class' 제외 (수업은 관리자만). default=meeting.
    """
    semester_id: int | None = None  # 미지정 시 현재 학기
    entry_type: Literal["meeting", "consultation", "event", "other"] = "meeting"
    day_of_week: int = Field(0, ge=0, le=6)
    period: int = Field(1, ge=1, le=20)
    subject: str | None = Field(None, max_length=100)
    room: str | None = Field(None, max_length=50)
    note: str | None = Field(None, max_length=255)


class MyEventUpdate(BaseModel):
    """PUT /api/timetable/my-events/{eid} — 부분 업데이트."""
    subject: str | None = Field(None, max_length=100)
    room: str | None = Field(None, max_length=50)
    note: str | None = Field(None, max_length=255)
    entry_type: Literal["meeting", "consultation", "event", "other"] | None = None


# ── 학기 enrollment positions ──

class EnrollmentPositionsSet(BaseModel):
    """PUT/POST .../positions[/sync-year]"""
    template_ids: list[int] = Field(default_factory=list)
