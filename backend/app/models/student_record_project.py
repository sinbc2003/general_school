"""생활기록부 자동작성 — 프로젝트(작업공간) / 학생(행) / 항목(열) / 셀.

설계 (001 AIteacherAgent_new 생기부 도구 이식 + general_school 자동화):
- RecordProject: 교사의 생기부 작성 프로젝트. 범위(scope) 선택 시 담당 학생 자동 행.
- RecordProjectStudent: 프로젝트에 포함된 학생(행). 범위에서 자동 채움 + 수동 가감.
- RecordColumn: 항목(열). 항목별 system_prompt + source_config(자동수집 소스).
- RecordCell: 학생 × 항목 셀. raw_data(원자료) ↔ generated_text(AI 결과) 분리.

AIagent 매핑:
- AIagent students[].activities["activity_N"](원자료/AI결과 한 셀 공존) → 여기선
  RecordCell.raw_data(원자료) / generated_text(AI결과) 분리 저장.
- AIagent students[].final_comprehensive_opinion(행 종합) → RecordProjectStudent.final_text.
- AIagent activities[].systemPrompt → RecordColumn.system_prompt.

CLAUDE.md:
- app/models/__init__.py에 import 등록 (백업 자동 포함 보장)
- 학생 생기부 = 초민감. 라우터에서 visibility 가드 필수.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class RecordProject(Base):
    """생기부 작성 프로젝트 (학생 행 × 항목 열 매트릭스 작업공간)."""
    __tablename__ = "record_projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="새 생활기록부")
    # 범위: course | homeroom | club | group | research | manual
    scope_type: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    # 범위 참조 id (course_id / club_id / group_id 등). homeroom은 scope_ref_class에.
    scope_ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 담임/학급 범위용 "학년-반" (예: "3-2")
    scope_ref_class: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 프로젝트 전역 프롬프트 (모든 항목 생성 시 앞에 결합)
    global_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Soft delete (휴지통)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    columns: Mapped[list["RecordColumn"]] = relationship(
        back_populates="project", cascade="all, delete-orphan",
    )
    students: Mapped[list["RecordProjectStudent"]] = relationship(
        back_populates="project", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_record_projects_owner_id", "owner_id"),
        Index("ix_record_projects_semester_id", "semester_id"),
    )


class RecordProjectStudent(Base):
    """프로젝트에 포함된 학생(행). 범위에서 자동 채움 + 수동 가감."""
    __tablename__ = "record_project_students"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("record_projects.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 종합(행 단위) 결과 — 여러 열을 합친 최종 종합의견(행동특성 등)
    final_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 교사 확정·공개 (학생 본인 열람 노출 — Phase 6)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    project: Mapped["RecordProject"] = relationship(back_populates="students")

    __table_args__ = (
        UniqueConstraint("project_id", "student_id", name="uq_record_project_student"),
        Index("ix_record_project_students_project_id", "project_id"),
        Index("ix_record_project_students_student_id", "student_id"),
    )


class RecordColumn(Base):
    """항목(열). 항목별 system_prompt + 자동수집 source_config."""
    __tablename__ = "record_columns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("record_projects.id", ondelete="CASCADE"), nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="새 항목")
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 자동 주입 소스 설정: {"type": "survey"|"assignment"|..., "filters": {...}}
    source_config: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    char_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # normal | summary (종합 열 — 다른 열을 합쳐 행 종합 생성)
    kind: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    project: Mapped["RecordProject"] = relationship(back_populates="columns")
    cells: Mapped[list["RecordCell"]] = relationship(
        back_populates="column", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_record_columns_project_id", "project_id"),
    )


class RecordCell(Base):
    """셀 (학생 × 항목). 원자료(raw_data) ↔ AI 생성 결과(generated_text) 분리."""
    __tablename__ = "record_cells"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("record_projects.id", ondelete="CASCADE"), nullable=False,
    )
    column_id: Mapped[int] = mapped_column(
        ForeignKey("record_columns.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # 자동수집/수동 원자료 (학생 제출물 파싱 텍스트)
    raw_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 출처 메타 [{"source": "survey", "ref_id": 3, "title": "..."}]
    raw_sources: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    # AI 생성 결과 (확정본)
    generated_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # empty | collected | generated | accepted
    status: Mapped[str] = mapped_column(String(20), default="empty", nullable=False)
    # 동일 열 내 다른 학생과의 최고 유사도 (0~1, Phase 5)
    similarity_flag: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    column: Mapped["RecordColumn"] = relationship(back_populates="cells")

    __table_args__ = (
        UniqueConstraint("column_id", "student_id", name="uq_record_cell"),
        Index("ix_record_cells_project_id", "project_id"),
        Index("ix_record_cells_column_id", "column_id"),
        Index("ix_record_cells_student_id", "student_id"),
    )
