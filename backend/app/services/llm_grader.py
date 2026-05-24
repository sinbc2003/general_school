"""문제은행 코스웨어 — LLM 자동 채점 서비스 (Few-shot + CoT + Self-Consistency).

신뢰도 향상 3대 기법 (학술 검증된):
  - A. Few-shot rubric: answer_data.examples를 prompt에 자동 주입 (QWK +26%)
  - B. CoT rationale  : {"reasoning", "score", "feedback"} JSON 강제 — 추론 후 채점
  - C. Self-Consistency: N회 호출 → 평균 score + σ. σ > 임계점이면 needs_review.

호출 모드:
  - grade_one_attempt(...)             — 단일 attempt (samples 회 호출 후 평균)
  - grade_pending_for_student(...)     — 학생 제출 시 background entry
  - grade_set_batch(...)               — 교사 trigger 동기 batch

설정 우선순위 (모델·samples 결정):
  1. 호출자 명시 (교사 trigger)
  2. ProblemSet.settings.llm_grader_provider / .llm_grader_model / .llm_grader_samples
  3. ChatbotConfig default_provider_student / default_model_student
  4. samples 기본 1 (비용 통제) — 출제자가 3/5로 켜야 SC 활성
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import statistics
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models import (
    ChatbotConfig, CourseProblemSet, LLMModel, Problem, StudentProblemAttempt,
)
from app.services.llm.base import LLMMessage
from app.services.llm.cost import calculate_cost_usd
from app.services.llm.registry import get_adapter


log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 상수 — 옵션·임계점
# ─────────────────────────────────────────────────────────────────────────────

_GRADING_CONCURRENCY = 3              # 동시 LLM 호출 수 (provider rate limit)
_SAMPLES_MAX = 7                      # samples 안전 상한 (비용 폭주 방지)
_NEEDS_REVIEW_STD_THRESHOLD = 0.15    # σ > 0.15면 신뢰도 낮음 — 사람 검토 필요
_MAX_FEW_SHOT_EXAMPLES = 5            # rubric examples 최대 개수
_DEFAULT_MAX_TOKENS = 1200            # CoT reasoning + score + feedback 공간


# ─────────────────────────────────────────────────────────────────────────────
# 프롬프트 빌더 — A(few-shot) + B(CoT) 통합
# ─────────────────────────────────────────────────────────────────────────────


def build_grading_prompt(
    problem: Problem, attempt: StudentProblemAttempt,
) -> tuple[str, list[LLMMessage]]:
    """채점 프롬프트 생성.

    구조:
      [System]
        - 채점관 역할
        - 응답 JSON 형식 강제: {"reasoning", "score", "feedback"}
      [User]
        - 문제
        - 채점 기준 (rubric)
        - 정답 예시 (problem.answer)
        - 채점 예시 (answer_data.examples) — few-shot calibration
        - 학생 답안
    """
    system = (
        "당신은 학교 시험 채점관입니다. 채점 기준과 예시에 따라 학생 답안을 "
        "0.0(완전 오답) ~ 1.0(완벽)로 평가합니다. 부분 점수 가능.\n\n"
        "응답은 반드시 다음 JSON 형식 1개만 출력하세요 (코드블록·설명·여분 텍스트 금지):\n"
        '{"reasoning": "1~3문장 채점 근거", "score": 0.85, "feedback": "..."}\n\n'
        "- reasoning: 점수를 부여한 이유 (학생에게 안 보이는 내부 메모)\n"
        "- score: 0.0 ~ 1.0 (실수)\n"
        "- feedback: 1~3문장 한국어 피드백 (학생에게 보여줄 메시지)"
    )

    answer_data = problem.answer_data or {}
    if not isinstance(answer_data, dict):
        answer_data = {}
    rubric = (answer_data.get("rubric") or "").strip()
    answer_example = (problem.answer or "").strip()

    # 채점 예시 (few-shot) — answer_data.examples
    examples_raw = answer_data.get("examples") or []
    few_shot_block = ""
    if isinstance(examples_raw, list) and examples_raw:
        lines = []
        for i, ex in enumerate(examples_raw[:_MAX_FEW_SHOT_EXAMPLES], start=1):
            if not isinstance(ex, dict):
                continue
            ans = str(ex.get("answer") or "").strip()
            sc = ex.get("score")
            comment = (ex.get("comment") or "").strip()
            if not ans or sc is None:
                continue
            try:
                sc_f = float(sc)
            except (TypeError, ValueError):
                continue
            line = f"[예{i}] 답안: \"{ans}\" → {sc_f:.2f}점"
            if comment:
                line += f" (사유: {comment})"
            lines.append(line)
        if lines:
            few_shot_block = "[채점 예시]\n" + "\n".join(lines)

    # 학생 답안
    sa = attempt.answer_data or {}
    if isinstance(sa, dict):
        student_text = (
            sa.get("text")
            or sa.get("value")
            or ", ".join(map(str, sa.get("selected", [])))
            or json.dumps(sa, ensure_ascii=False)
        )
    else:
        student_text = str(sa)

    user_parts = [f"[문제]\n{problem.content}"]
    if rubric:
        user_parts.append(f"[채점 기준]\n{rubric}")
    if answer_example:
        user_parts.append(f"[정답 예시]\n{answer_example}")
    if few_shot_block:
        user_parts.append(few_shot_block)
    user_parts.append(f"[학생 답안]\n{student_text}")
    user_parts.append("\nJSON으로만 답하세요.")

    user_msg = LLMMessage(role="user", content="\n\n".join(user_parts))
    return system, [user_msg]


# ─────────────────────────────────────────────────────────────────────────────
# 응답 파싱 — B(CoT) reasoning 분리
# ─────────────────────────────────────────────────────────────────────────────


_JSON_BLOB_RE = re.compile(r"\{[\s\S]*\}")
_SCORE_FALLBACK_RE = re.compile(r"(?:score|점수)\D{0,5}([01](?:\.\d+)?)", re.IGNORECASE)


def parse_llm_response(text: str) -> dict:
    """LLM 응답 → {score, feedback, reasoning?, error?}.

    1) text 통째로 json.loads
    2) {...} 블록만 추출 후 json.loads
    3) 정규식으로 score 추출 + feedback은 raw text
    """
    raw = (text or "").strip()
    if not raw:
        return {"score": 0.0, "feedback": "", "reasoning": "", "error": "빈 응답"}

    try:
        return _normalize_parsed(json.loads(raw), raw)
    except json.JSONDecodeError:
        pass

    m = _JSON_BLOB_RE.search(raw)
    if m:
        try:
            return _normalize_parsed(json.loads(m.group(0)), raw)
        except json.JSONDecodeError:
            pass

    sm = _SCORE_FALLBACK_RE.search(raw)
    if sm:
        try:
            return {
                "score": _clip01(float(sm.group(1))),
                "feedback": raw[:500],
                "reasoning": "",
                "error": "JSON 파싱 실패 — 정규식 fallback",
            }
        except ValueError:
            pass

    return {
        "score": 0.0,
        "feedback": raw[:500],
        "reasoning": "",
        "error": "응답 파싱 실패 (score 추출 불가)",
    }


def _normalize_parsed(obj: Any, raw: str) -> dict:
    if not isinstance(obj, dict):
        return {"score": 0.0, "feedback": raw[:500], "reasoning": "", "error": "응답이 object가 아님"}
    score = obj.get("score")
    feedback = obj.get("feedback") or obj.get("comment") or ""
    reasoning = obj.get("reasoning") or obj.get("rationale") or ""
    try:
        score_f = _clip01(float(score)) if score is not None else 0.0
    except (TypeError, ValueError):
        return {
            "score": 0.0, "feedback": str(feedback)[:500], "reasoning": str(reasoning)[:1000],
            "error": "score 숫자 변환 실패",
        }
    return {
        "score": score_f,
        "feedback": str(feedback)[:1000],
        "reasoning": str(reasoning)[:2000],
    }


def _clip01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return float(x)


# ─────────────────────────────────────────────────────────────────────────────
# Helper — 모델 + samples 결정
# ─────────────────────────────────────────────────────────────────────────────


async def resolve_grader_settings(
    db: AsyncSession,
    ps: CourseProblemSet,
    override_provider: str | None = None,
    override_model_id: str | None = None,
    override_samples: int | None = None,
) -> tuple[str | None, str | None, str | None, int]:
    """채점에 사용할 (provider, model_id, model_label, samples) 결정."""
    provider = override_provider
    model_id = override_model_id
    samples = override_samples

    settings = ps.settings or {}
    if not provider:
        provider = settings.get("llm_grader_provider")
    if not model_id:
        model_id = settings.get("llm_grader_model")
    if samples is None:
        samples = settings.get("llm_grader_samples")

    if not provider or not model_id:
        async def _cfg(key: str) -> str | None:
            row = (await db.execute(
                select(ChatbotConfig).where(ChatbotConfig.key == key)
            )).scalar_one_or_none()
            return row.value if row else None
        if not provider:
            provider = await _cfg("default_provider_student")
        if not model_id:
            model_id = await _cfg("default_model_student")

    # samples 정규화 — 1 이상, _SAMPLES_MAX 이하
    try:
        samples_n = int(samples or 1)
    except (TypeError, ValueError):
        samples_n = 1
    samples_n = max(1, min(_SAMPLES_MAX, samples_n))

    if not provider or not model_id:
        return None, None, None, samples_n

    m = (await db.execute(
        select(LLMModel).where(LLMModel.provider == provider, LLMModel.model_id == model_id)
    )).scalar_one_or_none()
    label = m.display_name if m else model_id
    return provider, model_id, label, samples_n


# 하위 호환 — 기존 호출자
async def resolve_grader_model(
    db: AsyncSession,
    ps: CourseProblemSet,
    override_provider: str | None = None,
    override_model_id: str | None = None,
) -> tuple[str | None, str | None, str | None]:
    p, m, lbl, _ = await resolve_grader_settings(
        db, ps, override_provider, override_model_id,
    )
    return p, m, lbl


# ─────────────────────────────────────────────────────────────────────────────
# 1회 호출 (sample 1개)
# ─────────────────────────────────────────────────────────────────────────────


async def _call_llm_once(
    db: AsyncSession,
    adapter, model_id: str, provider: str,
    system_text: str, messages: list[LLMMessage],
    temperature: float = 0.2,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> dict:
    """LLM 1회 호출 + parse + cost. 반환 dict:
      {score, feedback, reasoning, raw_response, tokens_in, tokens_out, cost_usd, error?}
    """
    full_text = ""
    input_tokens = 0
    output_tokens = 0
    error_text: str | None = None
    try:
        async for chunk in adapter.chat_stream(
            model=model_id, messages=messages, system=system_text,
            max_tokens=max_tokens, temperature=temperature,
        ):
            if chunk.error:
                error_text = chunk.error
            if chunk.delta:
                full_text += chunk.delta
            if chunk.done:
                input_tokens = chunk.input_tokens
                output_tokens = chunk.output_tokens
    except Exception as e:
        error_text = f"{type(e).__name__}: {e}"

    cost = await calculate_cost_usd(db, provider, model_id, input_tokens, output_tokens)

    if error_text and not full_text:
        return {
            "score": 0.0, "feedback": "", "reasoning": "",
            "raw_response": "", "tokens_in": input_tokens, "tokens_out": output_tokens,
            "cost_usd": cost, "error": error_text,
        }

    parsed = parse_llm_response(full_text)
    return {
        "score": parsed["score"],
        "feedback": parsed["feedback"],
        "reasoning": parsed.get("reasoning", ""),
        "raw_response": full_text[:4000],
        "tokens_in": input_tokens, "tokens_out": output_tokens,
        "cost_usd": cost,
        **({"error": parsed["error"]} if parsed.get("error") else {}),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 단일 attempt 채점 (samples회 호출 → 평균 + σ → SURE 마크)
# ─────────────────────────────────────────────────────────────────────────────


async def grade_one_attempt(
    db: AsyncSession,
    attempt: StudentProblemAttempt,
    problem: Problem,
    provider: str,
    model_id: str,
    model_label: str | None = None,
    samples: int = 1,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> dict:
    """attempt 1개 채점 (Self-Consistency 옵션).

    samples=1: 단발 호출 (default, 비용 통제)
    samples>1: N회 호출 → mean score + median feedback. σ > 임계점이면 needs_review.

    반환: llm_metadata dict (성공·실패 둘 다, error 키로 구분).
    """
    system_text, messages = build_grading_prompt(problem, attempt)

    adapter = await get_adapter(db, provider)
    now_iso = datetime.now(timezone.utc).isoformat()
    base_meta: dict = {
        "provider": provider, "model": model_id,
        "model_label": model_label or model_id,
        "samples": [],
        "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
        "raw_response": "",
        "graded_at": now_iso,
    }

    if adapter is None:
        base_meta["error"] = f"provider '{provider}' 어댑터 없음 (API 키 미등록·비활성)"
        attempt.grading_status = "failed"
        attempt.llm_metadata = base_meta
        return base_meta

    samples_n = max(1, min(_SAMPLES_MAX, samples))

    # 병렬 N회 호출 (sample 간 독립)
    call_tasks = [
        _call_llm_once(db, adapter, model_id, provider, system_text, messages)
        for _ in range(samples_n)
    ]
    results = await asyncio.gather(*call_tasks)

    # 결과 집계
    valid = [r for r in results if not r.get("error") or r.get("score") is not None]
    # score 모음
    scores = [r["score"] for r in results if not r.get("error")]
    tokens_in_total = sum(r.get("tokens_in", 0) for r in results)
    tokens_out_total = sum(r.get("tokens_out", 0) for r in results)
    cost_total = sum(r.get("cost_usd", 0.0) for r in results)

    base_meta["tokens_in"] = tokens_in_total
    base_meta["tokens_out"] = tokens_out_total
    base_meta["cost_usd"] = cost_total
    # 각 sample 요약 (raw_response는 너무 크니 score·reasoning·error만)
    base_meta["samples"] = [
        {
            "score": r.get("score"),
            "reasoning": r.get("reasoning", ""),
            "feedback": r.get("feedback", ""),
            "tokens_in": r.get("tokens_in", 0),
            "tokens_out": r.get("tokens_out", 0),
            "cost_usd": r.get("cost_usd", 0.0),
            **({"error": r["error"]} if r.get("error") else {}),
        }
        for r in results
    ]
    base_meta["raw_response"] = results[0].get("raw_response", "")[:4000] if results else ""

    if not scores:
        # 모두 실패
        first_err = next((r.get("error") for r in results if r.get("error")), "all samples failed")
        base_meta["error"] = first_err
        attempt.grading_status = "failed"
        attempt.llm_metadata = base_meta
        return base_meta

    # 평균·중앙값·표준편차
    mean_score = sum(scores) / len(scores)
    median_score = statistics.median(scores)
    std_score = statistics.pstdev(scores) if len(scores) >= 2 else 0.0
    base_meta["score_mean"] = round(mean_score, 4)
    base_meta["score_median"] = round(median_score, 4)
    base_meta["score_std"] = round(std_score, 4)

    # 최종 점수 — median (이상치 robust)
    final_score = median_score

    # feedback — 최다 빈도 score에 해당하는 sample (없으면 첫 sample)
    best_sample = _pick_best_feedback(results, final_score)
    feedback_body = (best_sample.get("feedback") or "").strip() or "(피드백 없음)"

    attempt.manual_score = _clip01(final_score)
    attempt.manual_feedback = f"(AI 채점) {feedback_body}"
    attempt.llm_metadata = base_meta
    attempt.graded_at = datetime.now(timezone.utc)

    # SURE — σ가 임계점 초과면 needs_review (samples >= 2일 때만 의미 있음)
    if samples_n >= 2 and std_score > _NEEDS_REVIEW_STD_THRESHOLD:
        attempt.grading_status = "needs_review"
    else:
        attempt.grading_status = "done"

    return base_meta


def _pick_best_feedback(results: list[dict], target_score: float) -> dict:
    """target_score에 가장 가까운 sample의 feedback 선택."""
    valid = [r for r in results if not r.get("error")]
    if not valid:
        return {}
    return min(valid, key=lambda r: abs(r.get("score", 0.0) - target_score))


# ─────────────────────────────────────────────────────────────────────────────
# Background entry — 학생 제출 시
# ─────────────────────────────────────────────────────────────────────────────


async def grade_pending_for_student(
    psid: int, student_id: int, attempt_number: int,
) -> None:
    """학생 (psid, student_id, attempt_number)의 pending attempt 일괄 채점.

    asyncio.create_task로 spawn돼 /submit 응답과 분리. 자체 DB session 사용.
    """
    async with async_session_factory() as db:
        try:
            ps = await db.get(CourseProblemSet, psid)
            if not ps:
                return

            rows = (await db.execute(
                select(StudentProblemAttempt).where(
                    StudentProblemAttempt.problem_set_id == psid,
                    StudentProblemAttempt.student_id == student_id,
                    StudentProblemAttempt.attempt_number == attempt_number,
                    StudentProblemAttempt.grading_status == "pending",
                )
            )).scalars().all()
            if not rows:
                return

            provider, model_id, label, samples = await resolve_grader_settings(db, ps)
            if not provider or not model_id:
                for a in rows:
                    a.grading_status = "failed"
                    a.llm_metadata = {
                        "error": "default provider/model 미설정 — 관리자 설정 필요",
                        "graded_at": datetime.now(timezone.utc).isoformat(),
                    }
                await db.commit()
                return

            for a in rows:
                a.grading_status = "running"
            await db.commit()

            pids = [a.problem_id for a in rows]
            problems = (await db.execute(
                select(Problem).where(Problem.id.in_(pids))
            )).scalars().all()
            p_by_id = {p.id: p for p in problems}

            sem = asyncio.Semaphore(_GRADING_CONCURRENCY)

            async def _one(a: StudentProblemAttempt):
                p = p_by_id.get(a.problem_id)
                if not p:
                    a.grading_status = "failed"
                    a.llm_metadata = {
                        "error": "Problem 없음",
                        "graded_at": datetime.now(timezone.utc).isoformat(),
                    }
                    return
                async with sem:
                    try:
                        await grade_one_attempt(
                            db, a, p, provider, model_id, label, samples=samples,
                        )
                    except Exception as e:
                        log.exception("grade_one_attempt failed attempt=%s", a.id)
                        a.grading_status = "failed"
                        a.llm_metadata = {
                            "error": f"{type(e).__name__}: {e}",
                            "graded_at": datetime.now(timezone.utc).isoformat(),
                        }

            await asyncio.gather(*[_one(a) for a in rows], return_exceptions=False)
            await db.commit()
        except Exception:
            log.exception("grade_pending_for_student failed psid=%s sid=%s", psid, student_id)


# ─────────────────────────────────────────────────────────────────────────────
# Background entry — 교사 trigger batch
# ─────────────────────────────────────────────────────────────────────────────


async def grade_set_batch(
    db: AsyncSession,
    psid: int,
    provider: str | None = None,
    model_id: str | None = None,
    samples: int | None = None,
    only_ungraded: bool = True,
    force: bool = False,
) -> dict:
    """교사 trigger — ProblemSet 전체 LLM 채점 (동기, in-place).

    조건: essay/manual/llm grader + (only_ungraded면 manual_score IS NULL).
    """
    from app.services.courseware_grader import MANUAL_GRADER_TYPES

    ps = await db.get(CourseProblemSet, psid)
    if not ps:
        return {
            "total": 0, "graded": 0, "needs_review": 0, "failed": 0,
            "total_cost_usd": 0.0, "errors": [],
        }

    p, mid, label, samples_n = await resolve_grader_settings(
        db, ps, provider, model_id, samples,
    )
    if not p or not mid:
        return {
            "total": 0, "graded": 0, "needs_review": 0, "failed": 0,
            "total_cost_usd": 0.0,
            "errors": [{"attempt_id": None, "message": "provider/model 미지정 + 기본값 없음"}],
        }

    all_attempts = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == psid,
        )
    )).scalars().all()
    pids = list({a.problem_id for a in all_attempts})
    problems = (await db.execute(
        select(Problem).where(Problem.id.in_(pids))
    )).scalars().all() if pids else []
    p_by_id = {pr.id: pr for pr in problems}

    targets: list[StudentProblemAttempt] = []
    for a in all_attempts:
        pr = p_by_id.get(a.problem_id)
        if not pr:
            continue
        grader = (pr.answer_data or {}).get("grader_type", "").lower() if pr.answer_data else ""
        if grader not in MANUAL_GRADER_TYPES:
            continue
        if not force and only_ungraded and a.manual_score is not None:
            continue
        targets.append(a)

    if not targets:
        return {
            "total": 0, "graded": 0, "needs_review": 0, "failed": 0,
            "total_cost_usd": 0.0, "errors": [],
        }

    for a in targets:
        a.grading_status = "running"
    await db.commit()

    sem = asyncio.Semaphore(_GRADING_CONCURRENCY)
    cost_sum = 0.0
    graded = 0
    needs_review = 0
    failed = 0
    errors: list[dict] = []

    async def _one(a: StudentProblemAttempt):
        nonlocal cost_sum, graded, needs_review, failed
        pr = p_by_id.get(a.problem_id)
        if not pr:
            a.grading_status = "failed"
            failed += 1
            errors.append({"attempt_id": a.id, "message": "Problem 없음"})
            return
        async with sem:
            try:
                meta = await grade_one_attempt(
                    db, a, pr, p, mid, label, samples=samples_n,
                )
                cost_sum += float(meta.get("cost_usd") or 0.0)
                if meta.get("error"):
                    failed += 1
                    errors.append({"attempt_id": a.id, "message": meta["error"]})
                elif a.grading_status == "needs_review":
                    needs_review += 1
                else:
                    graded += 1
            except Exception as e:
                a.grading_status = "failed"
                failed += 1
                errors.append({"attempt_id": a.id, "message": f"{type(e).__name__}: {e}"})

    await asyncio.gather(*[_one(a) for a in targets])
    await db.commit()

    return {
        "total": len(targets),
        "graded": graded,
        "needs_review": needs_review,
        "failed": failed,
        "samples": samples_n,
        "total_cost_usd": round(cost_sum, 6),
        "errors": errors[:20],
    }
