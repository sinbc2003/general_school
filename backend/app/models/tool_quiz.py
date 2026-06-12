"""라이브 퀴즈 (Kahoot형) — 업무 및 수업 도구 #1.

교사가 코스웨어 문제 세트(CourseProblemSet)로 게임 세션을 열고, 학생이 PIN으로
입장해 실시간 동시 출제·속도 점수·리더보드로 진행한다.

테이블:
  - live_quiz_sessions : 게임 세션 (PIN, 상태 머신, 현재 문제 index)
  - live_quiz_players  : 참가자 (인증 사용자, 누적 점수)
  - live_quiz_answers  : 문제별 답안 (속도·점수 기록)

상태 머신 (host가 전이):
  lobby → question → reveal → question → ... → ended
                       ↘ (마지막 문제 reveal 후 next) → ended

문제 본체는 archive.problems 재사용. 세션 생성 시 자동채점 가능한 문제만
problem_ids 에 snapshot (이후 문제 세트가 바뀌어도 세션은 영향 없음).
진행 동기화는 2초 폴링 (WS는 v2).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LiveQuizSession(Base):
    """라이브 퀴즈 게임 세션 1회.

    settings JSON:
      - time_per_question : 문제당 제한 시간 초 (default 30)
      - show_leaderboard  : reveal마다 리더보드 표시 (default True)
    problem_ids: 세션 생성 시점 snapshot (자동채점 가능 문제만, ordered)
    """
    __tablename__ = "live_quiz_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # NULL = 도구에서 직접 출제한 퀴즈 (코스웨어 문제세트 없이 Problem rows만)
    problem_set_id: Mapped[int | None] = mapped_column(
        ForeignKey("course_problem_sets.id", ondelete="CASCADE"), nullable=True,
    )
    host_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    pin: Mapped[str] = mapped_column(String(6), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="lobby", nullable=False,
    )  # lobby | question | reveal | ended
    current_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 현재 문제 출제 시각 — 속도 점수 + 제한 시간 판정 기준
    question_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    problem_ids: Mapped[list[Any] | None] = mapped_column(JSON, default=list, nullable=True)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    __table_args__ = (
        # 진행 중 세션 PIN 조회 (join). 전역 UNIQUE는 안 함 — ended 세션이 pin 보존.
        Index("ix_live_quiz_sessions_pin_status", "pin", "status"),
        Index("ix_live_quiz_sessions_host", "host_id", "created_at"),
    )


class LiveQuizPlayer(Base):
    """세션 참가자. 인증 사용자만 (익명 게스트는 v2 — nickname 컬럼은 미리 둠)."""
    __tablename__ = "live_quiz_players"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_sessions.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True,
    )
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_quiz_player_session_user"),
        Index("ix_live_quiz_players_session", "session_id"),
    )


class LiveQuizAnswer(Base):
    """문제별 답안 1건 (플레이어당 문제당 1회).

    answer JSON 형식은 코스웨어 submission과 동일:
      - 객관식 {"selected": ["A"]} / 단답 {"text": "..."} / 수치 {"value": 3.14}
    points: Kahoot식 — 정답 시 1000 × (1 - (t/limit)/2), 오답 0.
    """
    __tablename__ = "live_quiz_answers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_sessions.id", ondelete="CASCADE"), nullable=False,
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_players.id", ondelete="CASCADE"), nullable=False,
    )
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problems.id", ondelete="CASCADE"), nullable=False,
    )
    answer: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    ms_taken: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    points: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "session_id", "player_id", "problem_id",
            name="uq_quiz_answer_session_player_problem",
        ),
        Index("ix_live_quiz_answers_session_problem", "session_id", "problem_id"),
    )
