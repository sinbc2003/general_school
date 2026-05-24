"""문제은행 코스웨어 — 강좌 안에서 문제 출제·풀이·자동채점.

Assignment(파일 제출형 수행평가) / Contest(올림피아드 시험)와 별개의 시스템:
  - 객관식·단답·수치·주관식 문제를 강좌 단위로 출제
  - 학생이 즉시 풀이 → 자동 채점 → 점수 누적
  - 주관식은 LLM 채점 옵션 (chatbot provider 재사용)

테이블:
  - course_problem_sets : 강좌별 문제 묶음 (출제 단위)
  - student_problem_attempts : 학생 답안 + 채점 결과

Problem 본체는 기존 archive.problems 테이블 재사용 (answer_data JSON 컬럼 추가).
inline 출제 (강좌 안에서 새로 작성)는 course_problem_sets.problem_ids에 새 Problem
row id를 ordered list로 박는 방식.
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
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CourseProblemSet(Base):
    """강좌 단위 문제 묶음 (출제 단위).

    교사가 강좌에서 "이번 주 연습문제" 식으로 출제. status=published 되면 학생이
    풀이 가능. due_date 이후는 자동 close (옵션).

    problem_ids: ordered list of Problem.id (archive.problems 테이블).
    settings: 추가 옵션 (shuffle_questions, shuffle_choices, show_score_to_student 등)
    """
    __tablename__ = "course_problem_sets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ordered: [3, 1, 5, ...] — Problem.id 순서대로 출제
    problem_ids: Mapped[list[Any] | None] = mapped_column(JSON, default=list, nullable=True)

    # 출제 정책
    status: Mapped[str] = mapped_column(
        String(20), default="draft", nullable=False,
    )  # draft | published | closed
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_attempts: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    show_solution_after_due: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False,
    )
    # 추가 settings (확장용)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
    # 휴지통 (soft delete) — 30일 후 cron purge (drive 패턴 동일)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    __table_args__ = (
        Index("ix_course_problem_sets_course_id", "course_id"),
        Index("ix_course_problem_sets_status", "status"),
        Index("ix_course_problem_sets_course_active", "course_id", "status", "deleted_at"),
    )


class StudentProblemAttempt(Base):
    """학생 답안 + 자동/수동 채점 결과.

    UNIQUE(problem_set_id, problem_id, student_id, attempt_number) — 학생당 시도별 1행.
    attempt_number는 1부터 시작 — max_attempts 검사 시 사용.

    answer_data 형식 (Problem.type 별):
      - multiple_choice : {"selected": ["A", "C"]}    # 다중 정답 허용
      - short_answer    : {"text": "사용자 입력 텍스트"}
      - numeric         : {"value": 3.14}
      - essay           : {"text": "..."}             # auto_score=0, manual_score 필요
      - code            : {"language": "py", "source": "..."}

    채점 흐름:
      1) submit endpoint에서 services/courseware_grader.py 호출
      2) Problem.answer_data.grader_type 보고 비교 → is_correct + auto_score
      3) essay/manual은 manual_score 필드를 교사가 나중에 채움
    """
    __tablename__ = "student_problem_attempts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    problem_set_id: Mapped[int] = mapped_column(
        ForeignKey("course_problem_sets.id", ondelete="CASCADE"), nullable=False,
    )
    problem_id: Mapped[int] = mapped_column(
        ForeignKey("problems.id", ondelete="CASCADE"), nullable=False,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    answer_data: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 자동 채점 결과
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    auto_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 수동 채점 (essay/주관식 — 교사 직접 또는 LLM)
    manual_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    manual_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    graded_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    # LLM 채점 상태 — 'none' (LLM 대상 X) / 'pending' / 'running' / 'done' / 'failed'
    # 자동채점 가능(choices/exact/regex/numeric) attempt는 'none'.
    # essay/manual/llm grader는 학생 제출 시 settings.llm_grader_enabled에 따라
    # 'pending' 으로 저장 → background task가 'running' → 'done'/'failed' 전이.
    grading_status: Mapped[str] = mapped_column(
        String(20), default="none", nullable=False, server_default="none",
    )
    # LLM 채점 메타데이터 (감사·재현·비용 추적)
    # 형식: {"provider": str, "model": str, "model_label": str,
    #        "tokens_in": int, "tokens_out": int, "cost_usd": float,
    #        "raw_response": str, "graded_at": iso8601, "error": str?}
    llm_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    graded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    __table_args__ = (
        UniqueConstraint(
            "problem_set_id", "problem_id", "student_id", "attempt_number",
            name="uq_attempt_set_problem_student_n",
        ),
        Index("ix_attempts_set_student", "problem_set_id", "student_id"),
        Index("ix_attempts_set_problem", "problem_set_id", "problem_id"),
        Index("ix_attempts_student_submitted", "student_id", "submitted_at"),
    )
