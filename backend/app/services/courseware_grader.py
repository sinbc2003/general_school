"""문제은행 코스웨어 자동채점 헬퍼.

Problem.answer_data.grader_type 별 비교 + 점수 산출.

grader_type:
  - choices  : 객관식 set 비교 (다중정답 허용). answer_data = {"correct": ["A", "C"]}, sub = {"selected": ["A", "C"]}
  - exact    : 단답형 문자열 일치. answer_data = {"correct": "정답", "case_sensitive": false, "trim": true}
  - regex    : 정규식 매치. answer_data = {"pattern": "^[0-9]+$"}
  - numeric  : 수치 (tolerance). answer_data = {"value": 3.14, "tolerance": 0.01}
  - essay    : 주관식. 자동 채점 X (manual_score 0, is_correct=None)
  - manual   : 교사 직접 채점 (essay와 동일)
  - llm      : LLM 채점 — Phase 2에서 활성 (지금은 manual 동일 처리)

반환: (is_correct: bool | None, auto_score: float)
  - is_correct: None이면 채점 불가 (essay/manual/llm), True/False면 자동 채점.
  - auto_score: 0.0 ~ 1.0 (1.0 = 정답, 0.0 = 오답 or 채점 불가).
  - 부분점수는 향후 확장 — 현재는 binary.
"""

from __future__ import annotations

import logging
import re
from typing import Any

log = logging.getLogger(__name__)


AUTO_GRADER_TYPES = {"choices", "exact", "regex", "numeric"}
MANUAL_GRADER_TYPES = {"essay", "manual", "llm"}


def grade_answer(
    answer_data: dict | None,
    submission: dict | None,
) -> tuple[bool | None, float]:
    """answer_data와 학생 submission을 비교해 채점.

    answer_data가 None / 알 수 없는 grader_type이면 (None, 0.0) 반환.
    submission None은 무응답으로 (False, 0.0).
    """
    if not answer_data or not isinstance(answer_data, dict):
        return (None, 0.0)
    grader = (answer_data.get("grader_type") or "").strip().lower()

    if grader in MANUAL_GRADER_TYPES:
        return (None, 0.0)

    if not submission or not isinstance(submission, dict):
        return (False, 0.0)

    try:
        if grader == "choices":
            return _grade_choices(answer_data, submission)
        if grader == "exact":
            return _grade_exact(answer_data, submission)
        if grader == "regex":
            return _grade_regex(answer_data, submission)
        if grader == "numeric":
            return _grade_numeric(answer_data, submission)
    except Exception as e:
        log.warning("grade_answer failed grader=%s: %s", grader, e)
        return (None, 0.0)

    # 알 수 없는 type
    return (None, 0.0)


def _grade_choices(answer_data: dict, submission: dict) -> tuple[bool, float]:
    correct_raw = answer_data.get("correct")
    if correct_raw is None:
        return (False, 0.0)
    correct = set(_as_list(correct_raw))
    selected = set(_as_list(submission.get("selected")))
    ok = correct == selected and len(correct) > 0
    return (ok, 1.0 if ok else 0.0)


def _grade_exact(answer_data: dict, submission: dict) -> tuple[bool, float]:
    correct = answer_data.get("correct")
    if correct is None:
        return (False, 0.0)
    text = submission.get("text")
    if text is None:
        return (False, 0.0)
    a = str(correct)
    b = str(text)
    if answer_data.get("trim", True):
        a, b = a.strip(), b.strip()
    if not answer_data.get("case_sensitive", False):
        a, b = a.lower(), b.lower()
    ok = a == b
    return (ok, 1.0 if ok else 0.0)


def _grade_regex(answer_data: dict, submission: dict) -> tuple[bool, float]:
    pattern = answer_data.get("pattern")
    if not pattern:
        return (False, 0.0)
    text = submission.get("text")
    if text is None:
        return (False, 0.0)
    flags = re.IGNORECASE if not answer_data.get("case_sensitive", False) else 0
    # DoS 방지 — 너무 긴 입력은 거부
    if len(str(text)) > 10_000:
        return (False, 0.0)
    try:
        ok = bool(re.search(pattern, str(text), flags=flags))
    except re.error:
        return (False, 0.0)
    return (ok, 1.0 if ok else 0.0)


def _grade_numeric(answer_data: dict, submission: dict) -> tuple[bool, float]:
    target = answer_data.get("value")
    if target is None:
        return (False, 0.0)
    val = submission.get("value")
    if val is None:
        # 학생이 text만 보냈을 수도 — float 변환 시도
        try:
            val = float(str(submission.get("text", "")).strip().replace(",", ""))
        except (ValueError, TypeError):
            return (False, 0.0)
    try:
        v = float(val)
        t = float(target)
    except (ValueError, TypeError):
        return (False, 0.0)
    tol = float(answer_data.get("tolerance") or 0.0)
    ok = abs(v - t) <= tol
    return (ok, 1.0 if ok else 0.0)


def _as_list(x: Any) -> list:
    if x is None:
        return []
    if isinstance(x, list):
        return [str(v).strip() for v in x if str(v).strip()]
    return [str(x).strip()]


def grade_problem_set(
    problems_with_answers: list[tuple[int, dict | None]],
    submissions_by_problem: dict[int, dict | None],
) -> dict:
    """전체 문제 세트 채점 (problem_id별 결과 + 합계).

    problems_with_answers: [(problem_id, answer_data), ...]
    submissions_by_problem: {problem_id: submission_dict, ...}

    반환 형식:
      {
        "results": [{problem_id, is_correct, auto_score, has_manual_pending}, ...],
        "total": int,
        "auto_graded": int,
        "auto_correct": int,
        "manual_pending": int,
        "auto_score_sum": float,  # 0.0~auto_graded
      }
    """
    results = []
    auto_graded = 0
    auto_correct = 0
    manual_pending = 0
    auto_score_sum = 0.0

    for pid, ans in problems_with_answers:
        sub = submissions_by_problem.get(pid)
        is_correct, score = grade_answer(ans, sub)
        has_manual = (
            ans is not None
            and isinstance(ans, dict)
            and (ans.get("grader_type") or "").lower() in MANUAL_GRADER_TYPES
        )
        results.append({
            "problem_id": pid,
            "is_correct": is_correct,
            "auto_score": score,
            "has_manual_pending": has_manual,
        })
        if is_correct is None:
            if has_manual:
                manual_pending += 1
        else:
            auto_graded += 1
            if is_correct:
                auto_correct += 1
            auto_score_sum += score

    return {
        "results": results,
        "total": len(problems_with_answers),
        "auto_graded": auto_graded,
        "auto_correct": auto_correct,
        "manual_pending": manual_pending,
        "auto_score_sum": auto_score_sum,
    }
