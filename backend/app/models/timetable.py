"""시간표 모델 — 학기, 시간표 항목, 학기별 명단(SemesterEnrollment)

학기 시스템 핵심:
- Semester: 학기 정의 (year, semester, is_current)
- SemesterEnrollment: 학기별 사용자 명단 스냅샷 (NEIS 스타일).
  학생 진급/교직원 전출에 따라 학기마다 명단이 다름.
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Semester(Base):
    """학기"""
    __tablename__ = "semesters"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    entries: Mapped[list["TimetableEntry"]] = relationship(
        back_populates="semester_rel", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_semesters_year_semester", "year", "semester"),
        Index("ix_semesters_is_current", "is_current"),
    )


class TimetableEntry(Base):
    """시간표 항목"""
    __tablename__ = "timetable_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=월 ~ 4=금
    period: Mapped[int] = mapped_column(Integer, nullable=False)
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    class_name: Mapped[str] = mapped_column(String(50), nullable=False)
    room: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    semester_rel: Mapped["Semester"] = relationship(back_populates="entries")

    __table_args__ = (
        UniqueConstraint(
            "semester_id", "day_of_week", "period", "class_name",
            name="uq_timetable_slot",
        ),
        Index("ix_timetable_entries_semester_id", "semester_id"),
        Index("ix_timetable_entries_teacher_id", "teacher_id"),
    )


class SemesterEnrollment(Base):
    """학기별 사용자 명단 스냅샷 (NEIS 스타일)

    학생 진급/교직원 전출에 대응하기 위해, 사용자 신원(User)은 영구 보존하되
    학기별 학년/반/부서/상태를 별도 행으로 저장한다.

    - 학생: grade, class_number, student_number
    - 교직원: department, position, homeroom_class
    - status: active(재학/재직) / transferred(전출) / graduated(졸업) / on_leave(휴직/휴학)

    UI에서 "현재 학기" 전환 시 active enrollment 기준으로 명단을 보여준다.
    """
    __tablename__ = "semester_enrollments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # teacher / staff / student
    status: Mapped[str] = mapped_column(
        String(20), default="active", nullable=False
    )  # active / transferred / graduated / on_leave

    # 학생용 (role=student)
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    class_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    student_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 교직원용 (role in teacher/staff)
    department: Mapped[str | None] = mapped_column(String(50), nullable=True)
    position: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 부장/평교사 등
    homeroom_class: Mapped[str | None] = mapped_column(String(20), nullable=True)  # 예: "3-2"

    # 학기별 연락처 캐시 (User.phone과 동기화하지만 학기별로 보존)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("semester_id", "user_id", name="uq_semester_user"),
        Index("ix_semester_enrollments_semester_id", "semester_id"),
        Index("ix_semester_enrollments_user_id", "user_id"),
        Index("ix_semester_enrollments_role", "role"),
        Index("ix_semester_enrollments_status", "status"),
        Index("ix_semester_enrollments_grade_class", "grade", "class_number"),
    )
