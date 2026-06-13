"""실시간 투표·워드클라우드 (Mentimeter형) — 업무 및 수업 도구 #6.

교사가 질문 묶음(투표/워드클라우드)을 만들고 세션을 열면, 학생이 PIN으로
입장해 응답 — 호스트 화면에 막대그래프/워드클라우드가 실시간(2초 폴링) 갱신.

테이블:
  - tool_polls             : 질문 묶음 원본 (교사 자산 — 드라이브 통합, 학기 무관 재사용)
  - tool_poll_sessions     : 진행 세션 (PIN, 질문 snapshot, 현재 질문 index)
  - tool_poll_participants : 참여자 (인증 사용자)
  - tool_poll_responses    : 응답 — 1행 = 1응답 (워드클라우드는 단어당 1행)

상태 머신 (host가 전이): lobby → question(자유 이동 goto) → ended
점수·타이머 없음 (퀴즈와 다름) — 응답은 익명 집계로만 표시.
질문은 세션 생성 시 snapshot — 이후 원본을 수정해도 진행 중 세션은 영향 없음.
"""

from datetime import datetime
from typing import Any

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
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Poll(Base):
    """질문 묶음 원본.

    questions JSON (ordered list — 세션 생성 시 snapshot됨):
      choice    : {"id": "q1", "type": "choice", "prompt": str,
                   "options": [str], "multi": bool}
      wordcloud : {"id": "q2", "type": "wordcloud", "prompt": str,
                   "max_words": int(1~5, 1인당 단어 수)}
    id는 질문 편집을 견디는 stable 키 — 응답(question_id)이 참조.
    """
    __tablename__ = "tool_polls"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    questions: Mapped[list[Any] | None] = mapped_column(JSON, default=list, nullable=True)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
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
    # 질문 데이터는 DB row뿐이라 0 고정 — drive serialize 규약상 필요
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_tool_polls_owner", "owner_id", "deleted_at"),
    )


class PollSession(Base):
    """투표 진행 세션 1회.

    questions: 세션 생성 시점 snapshot (원본 Poll 편집·삭제와 독립).
    poll_id SET NULL — 원본을 휴지통에서 영구 삭제해도 지난 세션 결과는 보존.
    settings JSON:
      - results_to_students : 학생 기기에도 집계 표시 (default False — 발표 화면용)
    """
    __tablename__ = "tool_poll_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    poll_id: Mapped[int | None] = mapped_column(
        ForeignKey("tool_polls.id", ondelete="SET NULL"), nullable=True,
    )
    host_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    pin: Mapped[str] = mapped_column(String(6), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="lobby", nullable=False,
    )  # lobby | question | ended
    current_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    questions: Mapped[list[Any] | None] = mapped_column(JSON, default=list, nullable=True)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    __table_args__ = (
        # 진행 중 세션 PIN 조회 (join). 전역 UNIQUE는 안 함 — ended 세션이 pin 보존.
        Index("ix_tool_poll_sessions_pin_status", "pin", "status"),
        Index("ix_tool_poll_sessions_host", "host_id", "created_at"),
    )


class PollParticipant(Base):
    """세션 참여자. 인증 사용자만 (익명 게스트는 v2 — nickname 컬럼은 미리 둠)."""
    __tablename__ = "tool_poll_participants"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("tool_poll_sessions.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True,
    )
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_poll_participant_session_user"),
        Index("ix_tool_poll_participants_session", "session_id"),
    )


class PollResponse(Base):
    """응답 1건 — 워드클라우드는 단어당 1행 (answer_no = 단어 슬롯 0..max-1).

    answer JSON:
      choice    : {"selected": ["A"]}  (multi 질문이면 복수)
      wordcloud : {"word": "텍스트"}
    answer_no: choice는 항상 0 (참여자당 질문당 1회를 UNIQUE로 강제),
    워드클라우드는 슬롯 번호 — 동시 더블클릭 race도 UNIQUE가 잡음.
    """
    __tablename__ = "tool_poll_responses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("tool_poll_sessions.id", ondelete="CASCADE"), nullable=False,
    )
    participant_id: Mapped[int] = mapped_column(
        ForeignKey("tool_poll_participants.id", ondelete="CASCADE"), nullable=False,
    )
    question_id: Mapped[str] = mapped_column(String(50), nullable=False)
    answer: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    answer_no: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "session_id", "participant_id", "question_id", "answer_no",
            name="uq_poll_response_slot",
        ),
        Index("ix_tool_poll_responses_session_question", "session_id", "question_id"),
    )
