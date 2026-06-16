"""업무 도구 비동기 작업 (ToolJob) — PDF→HWPX 변환 / PDF 번역.

장시간(수십 초~수 분) 작업을 위한 잡 모델. 요청은 즉시 job_id를 반환하고
백그라운드 task가 status/progress를 갱신한다. 프론트엔드는
GET /api/tools/office/jobs/{id} 로 폴링한다.

입력 PDF + 결과 파일은 storage/tool_office/{job_id}/ 아래에 저장하며,
files 가드 `_guard_tool_office`가 "작업 소유 교사 본인 OR admin"만 다운로드를
허용한다 (output_file_url 컬럼이 가드의 매칭 대상).

※ tool_jobs는 학기 무관 개인 작업 기록 — 백업에 자동 포함
  (app/models/__init__.py 등록).
"""

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ToolJobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ToolJob(Base):
    """업무 도구 비동기 작업 1건."""

    __tablename__ = "tool_jobs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 도구 종류 — "pdf2hwpx" | "pdf_translate"
    tool: Mapped[str] = mapped_column(String(40), nullable=False)
    # native_enum=False → DB는 VARCHAR(+CHECK 없음) 저장 (PG ENUM 타입 DDL 회피).
    # 파이썬 코드는 ToolJobStatus 멤버로 읽고/쓴다.
    status: Mapped[ToolJobStatus] = mapped_column(
        Enum(ToolJobStatus, name="tooljobstatus", native_enum=False, length=20),
        default=ToolJobStatus.PENDING,
        nullable=False,
    )
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0~100
    stage: Mapped[str | None] = mapped_column(String(80), nullable=True)  # "OCR 중" 등

    owner_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    input_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 작업 옵션 (mode/doc_type/columns 또는 target_lang 등)
    options: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 결과 메타 (warnings, 페이지 수, 번역 인라인 텍스트 등)
    result_meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 결과 파일 경로 — "/storage/tool_office/{id}/out.hwpx" (files 가드 매칭 대상)
    output_file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("ix_tool_jobs_owner_id", "owner_id"),
        Index("ix_tool_jobs_tool_status", "tool", "status"),
    )
