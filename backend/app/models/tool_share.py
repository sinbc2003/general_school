"""에듀테크 도구 교사 간 공유 — 보드·단어장 공통.

교사가 만든 도구(원본)를 동료 교사에게 공유:
  - 공유받은 교사는 원본을 **열람** 가능 (보드는 실시간 보기, 단어장은 카드 보기)
  - 본인 수업에 쓰려면 **사본 생성**(duplicate) 후 본인 소유로 첨부 — 원본 보존

tool_type: 'board' | 'word_deck'  (퀴즈 세션은 1회성이라 공유 대상 아님 —
공유가 필요한 건 문제 세트이고 그건 코스웨어 공동교사 체계가 담당)
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EduToolShare(Base):
    __tablename__ = "edu_tool_shares"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tool_type: Mapped[str] = mapped_column(String(20), nullable=False)
    tool_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # 공유 받은 교사
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    shared_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("tool_type", "tool_id", "user_id", name="uq_tool_share"),
        Index("ix_tool_shares_tool", "tool_type", "tool_id"),
        Index("ix_tool_shares_user", "user_id", "tool_type"),
    )
