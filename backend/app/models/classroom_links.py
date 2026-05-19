"""클래스룸 단축 링크 — 설문·문서 공유용 짧은 URL.

설계:
  - slug: 6자리 base62 (충돌 시 7~8자리 재시도)
  - target_type: "survey" | "document" (추후 확장)
  - 만료(expires_at) 옵션
  - click_count: 익명 lookup 시 1 증가 (통계만, 인증 무관)
  - QR 코드는 별도 endpoint에서 동적 생성 (저장 X)

호환:
  - app/services/backup.py가 자동 export
  - app/models/__init__.py에 import 등록 必
"""

from datetime import datetime

from sqlalchemy import (
    DateTime, ForeignKey, Index, Integer, String, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ShortLink(Base):
    """단축 링크 — 익명 lookup 가능, 생성은 인증 필요."""
    __tablename__ = "classroom_shortlinks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 6~16자 base62. unique. 추측 어렵게 random_choice 사용.
    slug: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    # 현재: survey / document
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    click_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_classroom_shortlinks_slug", "slug", unique=True),
        Index("ix_classroom_shortlinks_target", "target_type", "target_id"),
        Index("ix_classroom_shortlinks_created_by_id", "created_by_id"),
    )
