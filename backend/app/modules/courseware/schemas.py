"""Pydantic schemas — courseware 모듈."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# Problem.type 표준화 — frontend display + grader 매핑에 사용
ProblemType = Literal[
    "multiple_choice",  # 객관식 (choices grader)
    "short_answer",     # 단답 (exact / regex grader)
    "numeric",          # 수치 (numeric grader, tolerance)
    "essay",            # 서술 (manual or llm)
    "code",             # 코드 (manual; Phase 2+ sandbox)
]

GraderType = Literal["choices", "exact", "regex", "numeric", "essay", "manual", "llm"]
ProblemSetStatus = Literal["draft", "published", "closed"]


# ─────────────────────────────────────────────────────────────────────────────
# Problem inline (출제 모달에서 새로 작성)
# ─────────────────────────────────────────────────────────────────────────────

class ProblemInline(BaseModel):
    """ProblemSet 생성·편집 시 문제를 inline으로 작성.

    기존 archive Problem 테이블에 row를 만들고 그 id를 problem_ids에 박는다.
    archive 라이브러리에서 가져오는 옵션은 Phase 2 이후 — 현재는 inline만.

    answer_data: 자동채점 메타 (services/courseware_grader.py 참조)
      - choices : {"correct": ["A", "C"]}
      - exact   : {"correct": "정답", "case_sensitive": false}
      - regex   : {"pattern": "^[0-9]+$"}
      - numeric : {"value": 3.14, "tolerance": 0.01}
      - essay/manual : {"rubric": "..."}              # 자동채점 X
    """
    type: ProblemType = "short_answer"
    content: str = Field(..., min_length=1, max_length=20000)  # TipTap HTML 또는 텍스트
    solution: str | None = Field(default=None, max_length=20000)  # 해설 (선택)
    answer: str | None = Field(default=None, max_length=500)      # 정답 표시용 (UI)
    # 자동채점 메타 — grader_type 필수, 나머지는 type별로
    answer_data: dict[str, Any] | None = None
    difficulty: Literal["easy", "medium", "hard", "olympiad"] = "medium"
    subject: str | None = Field(default=None, max_length=50)
    tags: list[str] | None = None


# ─────────────────────────────────────────────────────────────────────────────
# ProblemSet (출제 단위)
# ─────────────────────────────────────────────────────────────────────────────

class ProblemSetCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    problems: list[ProblemInline] = Field(default_factory=list, max_length=200)
    status: ProblemSetStatus = "draft"
    due_date: datetime | None = None
    time_limit_seconds: int | None = Field(default=None, ge=30, le=86400)
    max_attempts: int = Field(default=1, ge=1, le=99)
    show_solution_after_due: bool = True
    settings: dict[str, Any] | None = None


class ProblemSetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: ProblemSetStatus | None = None
    due_date: datetime | None = None
    time_limit_seconds: int | None = Field(default=None, ge=30, le=86400)
    max_attempts: int | None = Field(default=None, ge=1, le=99)
    show_solution_after_due: bool | None = None
    settings: dict[str, Any] | None = None
    # problem 목록 자체 교체 (전체 재배치)
    problems: list[ProblemInline] | None = Field(default=None, max_length=200)


# ─────────────────────────────────────────────────────────────────────────────
# 학생 제출
# ─────────────────────────────────────────────────────────────────────────────

class ProblemSubmission(BaseModel):
    """학생 답안 한 문제.

    submission 형식 (Problem.type 별):
      - multiple_choice : {"selected": ["A", "C"]}
      - short_answer    : {"text": "사용자 입력"}
      - numeric         : {"value": 3.14}            # 또는 {"text": "3.14"}
      - essay/code      : {"text": "..."}
    """
    problem_id: int = Field(..., gt=0)
    answer: dict[str, Any] = Field(default_factory=dict)


class SubmitAttemptReq(BaseModel):
    answers: list[ProblemSubmission] = Field(default_factory=list, max_length=200)


# ─────────────────────────────────────────────────────────────────────────────
# 교사 수동 채점
# ─────────────────────────────────────────────────────────────────────────────

class ManualGradeReq(BaseModel):
    attempt_id: int = Field(..., gt=0)
    score: float = Field(..., ge=0, le=1.0)  # 0.0 ~ 1.0 정규화 점수
    feedback: str | None = Field(default=None, max_length=2000)


# ─────────────────────────────────────────────────────────────────────────────
# LLM 자동 채점
# ─────────────────────────────────────────────────────────────────────────────


class LLMGradeReq(BaseModel):
    """교사 trigger batch LLM 채점 요청."""
    provider: str | None = None       # None이면 settings/system default
    model_id: str | None = None
    samples: int | None = Field(default=None, ge=1, le=7)  # Self-Consistency 횟수
    only_ungraded: bool = True        # manual_score가 NULL인 것만
    force: bool = False               # True면 이미 채점된 것도 덮어쓰기


class LLMGradeResultResp(BaseModel):
    total: int
    graded: int
    needs_review: int = 0             # σ > 임계점인 attempt (사람 검토 필요)
    failed: int
    samples: int = 1
    total_cost_usd: float
    errors: list[dict[str, Any]] = Field(default_factory=list)


class LLMGradePreviewResp(BaseModel):
    """dry-run cost 예측 응답."""
    eligible_attempts: int            # 채점 대상 개수
    provider: str | None
    model_id: str | None
    model_label: str | None
    samples: int = 1
    input_per_1m_usd: float
    output_per_1m_usd: float
    estimated_cost_usd: float         # 평균 토큰 × samples 추정 기반
