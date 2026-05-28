"""교사 임시 그룹 모델 — 행사/대회/연구 등 학기 안에서 수시 발생.

흐름:
1. 부장교사가 그룹 생성 (TeacherGroup) + 참여 교사 초대 (TeacherGroupMember)
2. 참여 교사가 본인 담당 학생을 학번으로 검색해 배정 (TeacherGroupStudent)
3. 학생이 산출물 업로드 (GroupSubmission, status=pending)
4. 담당 교사(assigned_teacher_id)가 승인/거부
5. 승인 시 StudentArtifact 자동 생성 → 학생 산출물 갤러리에 동시 등록

동아리(Club)는 별도 모델 유지 — 학기 내내 고정된 advisor + members.
TeacherGroup은 수시·일회성 행사/대회/연구 활동에 사용.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TeacherGroup(Base):
    """교사 임시 그룹 — 행사/대회/연구/기타 활동 단위.

    type: "event" | "contest" | "research" | "etc"
    owner: 부장교사 (또는 그룹 만든 사람). admin이 위임으로 부여도 가능.
    """
    __tablename__ = "teacher_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="event", nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_teacher_groups_semester", "semester_id"),
        Index("ix_teacher_groups_owner", "owner_id"),
        Index("ix_teacher_groups_type", "type"),
    )


class TeacherGroupMember(Base):
    """참여 교사 (M2M)."""
    __tablename__ = "teacher_group_members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("teacher_groups.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), default="member", nullable=False)  # leader | member
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("group_id", "teacher_id", name="uq_teacher_group_members"),
        Index("ix_teacher_group_members_teacher", "teacher_id"),
    )


class TeacherGroupStudent(Base):
    """학생 배정 — 어떤 교사가 어떤 학생을 자기 책임으로 등록했는지 기록.

    같은 그룹 안에서 1 학생 = 1 담당교사. 다른 교사가 같은 학생을 가져가려면
    먼저 해제해야 함 (단 admin은 강제 재배정 가능).
    """
    __tablename__ = "teacher_group_students"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("teacher_groups.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    assigned_teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("group_id", "student_id", name="uq_teacher_group_students"),
        Index("ix_teacher_group_students_group", "group_id"),
        Index("ix_teacher_group_students_student", "student_id"),
        Index("ix_teacher_group_students_assigned_teacher", "assigned_teacher_id"),
    )


class GroupSubmission(Base):
    """학생이 그룹 활동에 올리는 산출물.

    승인 흐름: pending → approved | rejected
    승인 시 StudentArtifact 자동 생성 (학생 산출물 갤러리에 동시 등록).
    """
    __tablename__ = "group_submissions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("teacher_groups.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    # pending | approved | rejected
    reviewed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    student_artifact_id: Mapped[int | None] = mapped_column(
        ForeignKey("student_artifacts.id", ondelete="SET NULL"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_group_submissions_group_status", "group_id", "status"),
        Index("ix_group_submissions_student", "student_id"),
        Index("ix_group_submissions_status", "status"),
    )
