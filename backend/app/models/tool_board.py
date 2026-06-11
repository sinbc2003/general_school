"""보드 (Padlet형) — 업무 및 수업 도구 #3.

담벼락(보드)에 포스트잇 카드를 붙이는 실시간 협업 도구.
카드 데이터는 DB가 아니라 **Yjs Y.Map** (Hocuspocus documentName=`board-{id}`) —
기존 doc-/deck-/sheet- 협업 인프라 재사용. DB는 메타 + yjs snapshot만 보관.

접근 정책 (_resolve_permission):
  - owner / admin           : 모든 권한
  - course_id 강좌 멤버      : 읽기 + 쓰기 (카드 붙이기가 목적)
  - 본인 강좌 글에 board 첨부 : 읽기 + 쓰기
  - access_mode="public"    : 인증 사용자 누구나 읽기 + 쓰기
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ToolBoard(Base):
    __tablename__ = "tool_boards"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 강좌에 묶으면 그 강좌 멤버(교사+active 수강생)가 읽기+쓰기
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="SET NULL"), nullable=True,
    )
    # members(기본 — 강좌/첨부 기반) | public(인증 사용자 누구나)
    access_mode: Mapped[str] = mapped_column(
        String(20), default="members", nullable=False,
    )
    # {"columns": ["컬럼1", "컬럼2", ...]} 등 레이아웃 설정
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Yjs CRDT snapshot (Hocuspocus가 주기 저장)
    yjs_state: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

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

    __table_args__ = (
        Index("ix_tool_boards_owner", "owner_id"),
        Index("ix_tool_boards_course", "course_id"),
    )
