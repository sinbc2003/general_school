"""연구 활동 담당교사 매핑 — 학생별 담당교사 + 학기 단위.

학생이 연구 보고서를 업로드하면 본인의 supervisor에게 알림 가고,
supervisor가 승인하면 past_research 아카이브 + 학생 산출물 갤러리에 저장됨.
"""

from datetime import datetime

from sqlalchemy import (
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


class ResearchSupervision(Base):
    """학생-담당교사 매핑 (학기 단위).

    같은 학기 안에서 학생 1명 = 담당교사 1명 (UNIQUE).
    학생이 여러 연구를 해도 담당교사는 1명 (관리 단순화).
    """
    __tablename__ = "research_supervisions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    supervisor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    topic_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("semester_id", "student_id", name="uq_research_supervisions_sem_student"),
        Index("ix_research_supervisions_supervisor", "supervisor_id"),
        Index("ix_research_supervisions_student", "student_id"),
    )
