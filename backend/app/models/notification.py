"""사용자 알림 모델.

용도: 강좌 공지/과제 게시, 과제 제출/리뷰 등 이벤트 발생 시 대상 사용자에게
in-app 알림 생성. Frontend는 polling으로 읽고, 사이드바 종 아이콘에 unread
count 표시.

브라우저 OS 알림(Notification API)은 frontend가 새 알림 도착 시 트리거.
Web Push (Service Worker)는 추후 확장.

설계:
- 사용자별 row (한 이벤트가 여러 사용자에게 발송되면 row N개 생성)
- type: 알림 카테고리 (classroom.post.new, assignment.submitted 등)
- link_url: 클릭 시 이동 경로 (frontend route)
- is_read: 읽음 여부 + read_at
- source_*: 원 이벤트 추적용 (감사·디버깅)

확장 전략:
- 매일 cron으로 30일 이상 read 알림 자동 정리 (대용량 누적 방지)
- type별 사용자 설정(켜기/끄기) 추후 추가 가능
"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Notification(Base):
    """사용자 단위 in-app 알림."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # 알림 카테고리 — "classroom.post.new" / "classroom.assignment.new" /
    # "classroom.submission.received" / "classroom.submission.reviewed" 등
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    # 표시용
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 클릭 시 이동할 frontend 경로 (예: "/s/classroom/12/posts/345")
    link_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 추가 메타 (강좌 ID, 게시글 ID 등 — frontend가 활용)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 원 이벤트 추적 (감사용)
    source_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    # 읽음
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        # 사용자별 최신순 (가장 자주 query) — 부분 인덱스로 unread만 빠르게도 가능
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_user_unread", "user_id", "is_read"),
    )
