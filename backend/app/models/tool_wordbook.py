"""단어장 (ClassCard형) — 업무 및 수업 도구 #2.

교사가 단어 덱(term-meaning-example)을 만들고, 학생이 3가지 모드
(플래시카드 암기 / 4지선다 리콜 / 스펠 타이핑)로 학습한다.
학습 진도는 라이트너 박스(1~5) — 맞히면 +1, 틀리면 1로 리셋, 낮은 박스 우선 출제.

테이블:
  - word_decks        : 덱 (소유자, 공개 여부)
  - word_cards        : 단어 카드 (덱 소속, 정렬 순서)
  - word_study_states : 사용자×카드 학습 상태 (라이트너 박스, 오답 횟수)

학생 접근: is_public OR 본인 소속 강좌 글에 word_deck 첨부 OR 소유자.
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


class WordDeck(Base):
    __tablename__ = "word_decks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "en-ko" (영→한), "ko-en", "ja-ko" 등 — 표시용
    lang_pair: Mapped[str] = mapped_column(String(20), default="en-ko", nullable=False)
    # True면 인증 사용자 누구나 학습 가능 (학생 홈 공개 목록에 노출)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
    # ── 내 드라이브 통합 (폴더·휴지통 30일 — drive ITEM_TYPES 규약) ──
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("drive_folders.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    # 카드 데이터는 DB row뿐이라 0 고정 — drive serialize 규약상 필요
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_word_decks_owner", "owner_id"),
        Index("ix_word_decks_public", "is_public"),
    )


class WordCard(Base):
    __tablename__ = "word_cards"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("word_decks.id", ondelete="CASCADE"), nullable=False,
    )
    term: Mapped[str] = mapped_column(String(255), nullable=False)
    meaning: Mapped[str] = mapped_column(String(500), nullable=False)
    example: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_word_cards_deck", "deck_id", "sort_order"),
    )


class WordStudyState(Base):
    """사용자×카드 라이트너 상태. 카드 삭제 시 함께 삭제 (CASCADE)."""
    __tablename__ = "word_study_states"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("word_decks.id", ondelete="CASCADE"), nullable=False,
    )
    card_id: Mapped[int] = mapped_column(
        ForeignKey("word_cards.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    box: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 1~5
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    wrong_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "card_id", name="uq_word_study_user_card"),
        Index("ix_word_study_deck_user", "deck_id", "user_id"),
    )
