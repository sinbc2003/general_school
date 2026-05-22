"""사용자 자료 즐겨찾기 (별표).

(user_id, item_type, item_id) 조합으로 단일 row. UNIQUE.
드라이브에서 자료 별표 ⭐ 표시 + "즐겨찾기" 필터 사용.

자료 type:
  - docs / sheets / decks / surveys / hwps

자료가 hard delete되어도 favorite 행은 cascade로 자동 삭제 — 단 cascade는
type별 모델별 처리가 어렵기 때문에 application 단에서 dead row 허용.
조회 시 join으로 자료 존재 여부 확인.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserFavoriteItem(Base):
    __tablename__ = "user_favorite_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # docs | sheets | decks | surveys | hwps
    item_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    item_id: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "item_type", "item_id", name="uq_user_favorite_item"),
        Index("ix_user_favorite_items_user_type", "user_id", "item_type"),
    )
