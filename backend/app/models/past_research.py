"""과거 학생 연구 보고서 아카이브 모델.

별도 모델인 이유: 기존 ResearchProject는 진행형 R&E(상태/일지/멤버) 추적용.
이 모델은 다른 학교에서 받은 ZIP(PDF 75개 등)을 일괄 등록 + 검색하기 위한
read-only 아카이브 전용. 일지/멤버/상태 없음.

파일명 패턴 예:
    2024 2학년 1학기 과학과제연구 보고서(물리 분야)_다이오드의 특성 곡선과 ...pdf
    2026 3학년 1학기 심층연구활동 보고서(화학, 인공지능 분야)_두 약물 ...pdf
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PastResearch(Base):
    """과거 학생 연구 보고서 (PDF 한 편 단위)."""
    __tablename__ = "past_researches"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    year: Mapped[int] = mapped_column(Integer, nullable=False)
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester: Mapped[int | None] = mapped_column(Integer, nullable=True)
    report_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    fields: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    is_excellent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    stored_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_past_researches_year", "year"),
        Index("ix_past_researches_year_semester", "year", "semester"),
        Index("ix_past_researches_report_type", "report_type"),
    )
