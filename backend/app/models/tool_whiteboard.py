"""공유 화이트보드 — 업무 및 수업 도구 #5.

실시간 협업 드로잉 캔버스 (Jamboard/Excalidraw 식). 펜·형광펜·도형·텍스트를
참가자 전원이 동시에 그린다.

스트로크 데이터는 DB가 아닌 **Yjs Y.Map("strokes")** (Hocuspocus
documentName=`whiteboard-{id}`) — 객체 단위 LWW (본인 객체만 수정/삭제라 충돌 없음).
DB는 메타 + yjs snapshot만 보관. 접근 정책은 보드(tool_board)와 동일 매트릭스:
owner/admin/강좌멤버/강좌 글 첨부/public 전부 읽기+쓰기(참여형), archived는 읽기만.
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


class ToolWhiteboard(Base):
    __tablename__ = "tool_whiteboards"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="SET NULL"), nullable=True,
    )
    # members(강좌/첨부 기반) | public(인증 사용자 누구나)
    access_mode: Mapped[str] = mapped_column(
        String(20), default="members", nullable=False,
    )
    # {"background": "white|grid|dark"} 등
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
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
        Index("ix_tool_whiteboards_owner", "owner_id"),
        Index("ix_tool_whiteboards_course", "course_id"),
    )
