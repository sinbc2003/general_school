"""문제은행 코스웨어 — LLM 자동 채점 서비스.

흐름:
  1. build_grading_prompt(problem, attempt) → (system_text, user_messages)
  2. adapter.chat_stream(...)을 모아 full_text 생성
  3. parse_llm_response(text) → {score, feedback, error?}
  4. cost_usd 계산 + StudentProblemAttempt 업데이트 (manual_score/feedback/llm_metadata)

호출 모드:
  - grade_one_attempt(...) — 단일 attempt (교사 trigger·background 공통)
  - grade_pending_for_student(...) — 학생 제출 시 background entry
    (그 (ps, student)의 grading_status='pending' attempt 일괄 처리)

설정 우선순위 (model 결정):
  1. 호출자가 명시한 provider/model_id (교사 trigger)
  2. ProblemSet.settings.llm_grader_provider / .llm_grader_model
  3. ChatbotConfig의 default_provider_student / default_model_student (학생용 기본)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
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
# 프롬프트 + 파싱
# ─────────────────────────────────────────────────────────────────────────────


def build_grading_prompt(
    problem: Problem, attempt: StudentProblemAttempt,
) -> tuple[str, list[LLMMessage]]:
    """채점 프롬프트 생성 — system + user 1개 메시지.

    응답 형식을 JSON 1개로 강제 (provider별 response_format 미사용 — 호환성).
    """
    system = (
        "당신은 학교 시험 채점관입니다. 주어진 채점 기준에 따라 학생 답안을 "
        "0.0(완전 오답) ~ 1.0(완벽)로 평가합니다. 부분 점수 가능.\n\n"
        "응답은 반드시 다음 JSON 형식 1개만 출력하세요 (다른 텍스트·코드블록·설명 금지):\n"
        '{"score": 0.85, "feedback": "..."}\n\n'
        "- score: 0.0 ~ 1.0 (실수)\n"
        "- feedback: 1~3문장 한국어 피드백 (왜 이 점수인지 학생이 이해할 수 있게)"
    )

    rubric = ""
    answer_data = problem.answer_data or {}
    if isinstance(answer_data, dict):
        rubric = (answer_data.get("rubric") or "").strip()

    answer_example = (problem.answer or "").strip()

    # 학생 답안 — answer_data 형식별
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

    user_parts = [
        f"[문제]\n{problem.content}",
    ]
    if rubric:
        user_parts.append(f"[채점 기준]\n{rubric}")
    if answer_example:
        user_parts.append(f"[정답 예시]\n{answer_example}")
    user_parts.append(f"[학생 답안]\n{student_text}")
    user_parts.append("\nJSON으로만 답하세요.")

    user_msg = LLMMessage(role="user", content="\n\n".join(user_parts))
    return system, [user_msg]


_JSON_BLOB_RE = re.compile(r"\{[\s\S]*\}")
_SCORE_FALLBACK_RE = re.compile(r"(?:score|점수)\D{0,5}([01](?:\.\d+)?)", re.IGNORECASE)


def parse_llm_response(text: str) -> dict:
    """LLM 응답 → {score, feedback, error?}.

    1) text 통째로 json.loads
    2) {...} 블록만 추출 후 json.loads
    3) 정규식으로 score 추출 + feedback은 raw text 전체
    실패 시 error 박음.
    """
    raw = (text or "").strip()
    if not raw:
        return {"score": 0.0, "feedback": "", "error": "빈 응답"}

    # 1) 통째로
    try:
        obj = json.loads(raw)
        return _normalize_parsed(obj, raw)
    except json.JSONDecodeError:
        pass

    # 2) 블록 추출 (코드블록 안에 있을 수도)
    m = _JSON_BLOB_RE.search(raw)
    if m:
        try:
            obj = json.loads(m.group(0))
            return _normalize_parsed(obj, raw)
        except json.JSONDecodeError:
            pass

    # 3) 정규식 fallback
    sm = _SCORE_FALLBACK_RE.search(raw)
    if sm:
        try:
            score = float(sm.group(1))
            return {
                "score": _clip01(score),
                "feedback": raw[:500],
                "error": "JSON 파싱 실패 — 정규식 fallback",
            }
        except ValueError:
            pass

    return {
        "score": 0.0,
        "feedback": raw[:500],
        "error": "응답 파싱 실패 (score 추출 불가)",
    }


def _normalize_parsed(obj: Any, raw: str) -> dict:
    if not isinstance(obj, dict):
        return {"score": 0.0, "feedback": raw[:500], "error": "응답이 object가 아님"}
    score = obj.get("score")
    feedback = obj.get("feedback") or obj.get("comment") or ""
    try:
        score_f = _clip01(float(score)) if score is not None else 0.0
    except (TypeError, ValueError):
        return {"score": 0.0, "feedback": str(feedback)[:500], "error": "score 숫자 변환 실패"}
    return {"score": score_f, "feedback": str(feedback)[:1000]}


def _clip01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return float(x)


# ─────────────────────────────────────────────────────────────────────────────
# Helper — 모델 결정
# ─────────────────────────────────────────────────────────────────────────────


async def resolve_grader_model(
    db: AsyncSession,
    ps: CourseProblemSet,
    override_provider: str | None = None,
    override_model_id: str | None = None,
) -> tuple[str | None, str | None, str | None]:
    """채점에 사용할 (provider, model_id, model_label) 결정.

    우선순위:
      1. 호출자 명시 (교사 trigger)
      2. ProblemSet.settings.llm_grader_provider / .llm_grader_model
      3. ChatbotConfig default_provider_student / default_model_student
    """
    provider = override_provider
    model_id = override_model_id

    if not provider or not model_id:
        settings = ps.settings or {}
        if not provider:
            provider = settings.get("llm_grader_provider")
        if not model_id:
            model_id = settings.get("llm_grader_model")

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

    if not provider or not model_id:
        return None, None, None

    # display label
    m = (await db.execute(
        select(LLMModel).where(
            LLMModel.provider == provider, LLMModel.model_id == model_id,
        )
    )).scalar_one_or_none()
    label = m.display_name if m else model_id
    return provider, model_id, label


# ─────────────────────────────────────────────────────────────────────────────
# 단일 attempt 채점
# ─────────────────────────────────────────────────────────────────────────────


async def grade_one_attempt(
    db: AsyncSession,
    attempt: StudentProblemAttempt,
    problem: Problem,
    provider: str,
    model_id: str,
    model_label: str | None = None,
    max_tokens: int = 800,
    temperature: float = 0.2,
) -> dict:
    """1개 attempt 채점 + DB 업데이트 (commit은 호출자가 책임).

    반환: llm_metadata dict (성공·실패 둘 다 포함, error 키로 구분).
    """
    system_text, messages = build_grading_prompt(problem, attempt)

    adapter = await get_adapter(db, provider)
    metadata: dict = {
        "provider": provider,
        "model": model_id,
        "model_label": model_label or model_id,
        "tokens_in": 0,
        "tokens_out": 0,
        "cost_usd": 0.0,
        "raw_response": "",
        "graded_at": datetime.now(timezone.utc).isoformat(),
    }

    if adapter is None:
        metadata["error"] = f"provider '{provider}' 어댑터 없음 (API 키 미등록·비활성)"
        attempt.grading_status = "failed"
        attempt.llm_metadata = metadata
        return metadata

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
    metadata["tokens_in"] = input_tokens
    metadata["tokens_out"] = output_tokens
    metadata["cost_usd"] = cost
    metadata["raw_response"] = full_text[:4000]  # cap 4KB

    if error_text and not full_text:
        metadata["error"] = error_text
        attempt.grading_status = "failed"
        attempt.llm_metadata = metadata
        return metadata

    parsed = parse_llm_response(full_text)
    if parsed.get("error"):
        # 점수는 best-effort로 박되 failed로 마크 (교사 검토 필요)
        metadata["error"] = parsed["error"]
        attempt.manual_score = parsed["score"]
        attempt.manual_feedback = f"(AI 채점) {parsed['feedback']}"
        attempt.grading_status = "failed"
        attempt.llm_metadata = metadata
        attempt.graded_at = datetime.now(timezone.utc)
        return metadata

    attempt.manual_score = parsed["score"]
    feedback_body = parsed["feedback"].strip() or "(피드백 없음)"
    attempt.manual_feedback = f"(AI 채점) {feedback_body}"
    attempt.grading_status = "done"
    attempt.llm_metadata = metadata
    attempt.graded_at = datetime.now(timezone.utc)
    return metadata


# ─────────────────────────────────────────────────────────────────────────────
# Background entry — 학생 제출 시
# ─────────────────────────────────────────────────────────────────────────────


_GRADING_CONCURRENCY = 3  # 동시 LLM 호출 수 (provider rate limit 보호)


async def grade_pending_for_student(
    psid: int, student_id: int, attempt_number: int,
) -> None:
    """학생 (psid, student_id, attempt_number)의 pending attempt 일괄 채점.

    이 함수는 ``asyncio.create_task``로 spawn돼 /submit 응답과 분리.
    자체 DB session을 사용 (호출자 session과 격리 — commit 안전).

    실패 시 attempt별 grading_status='failed' 마크만 하고 다음으로 진행.
    """
    async with async_session_factory() as db:
        try:
            ps = await db.get(CourseProblemSet, psid)
            if not ps:
                return

            # pending attempt 가져오기
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

            # 모델 결정 (이 학생 attempt 전체 동일)
            provider, model_id, label = await resolve_grader_model(db, ps)
            if not provider or not model_id:
                for a in rows:
                    a.grading_status = "failed"
                    a.llm_metadata = {
                        "error": "default provider/model 미설정 — 관리자 설정 필요",
                        "graded_at": datetime.now(timezone.utc).isoformat(),
                    }
                await db.commit()
                return

            # running 마크
            for a in rows:
                a.grading_status = "running"
            await db.commit()

            # Problem 일괄 로드
            pids = [a.problem_id for a in rows]
            problems = (await db.execute(
                select(Problem).where(Problem.id.in_(pids))
            )).scalars().all()
            p_by_id = {p.id: p for p in problems}

            # 병렬 채점 (semaphore)
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
                        await grade_one_attempt(db, a, p, provider, model_id, label)
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
    only_ungraded: bool = True,
    force: bool = False,
) -> dict:
    """교사 trigger — ProblemSet 전체 LLM 채점 (동기, in-place).

    조건:
      - Problem이 essay/manual/llm grader (자동채점 가능 grader 제외)
      - only_ungraded=True면 manual_score IS NULL 만 (force=True면 무시)

    반환: {total, graded, failed, total_cost_usd, errors: [...]}.
    """
    from app.services.courseware_grader import MANUAL_GRADER_TYPES

    ps = await db.get(CourseProblemSet, psid)
    if not ps:
        return {"total": 0, "graded": 0, "failed": 0, "total_cost_usd": 0.0, "errors": []}

    # 모델 결정
    p, mid, label = await resolve_grader_model(db, ps, provider, model_id)
    if not p or not mid:
        return {
            "total": 0, "graded": 0, "failed": 0, "total_cost_usd": 0.0,
            "errors": [{"attempt_id": None, "message": "provider/model 미지정 + 기본값 없음"}],
        }

    # 채점 대상 — 해당 ps의 모든 attempt 중 manual grader + (조건)
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
        return {"total": 0, "graded": 0, "failed": 0, "total_cost_usd": 0.0, "errors": []}

    # running 마크
    for a in targets:
        a.grading_status = "running"
    await db.commit()

    sem = asyncio.Semaphore(_GRADING_CONCURRENCY)
    cost_sum = 0.0
    graded = 0
    failed = 0
    errors: list[dict] = []

    async def _one(a: StudentProblemAttempt):
        nonlocal cost_sum, graded, failed
        pr = p_by_id.get(a.problem_id)
        if not pr:
            a.grading_status = "failed"
            failed += 1
            errors.append({"attempt_id": a.id, "message": "Problem 없음"})
            return
        async with sem:
            try:
                meta = await grade_one_attempt(db, a, pr, p, mid, label)
                cost_sum += float(meta.get("cost_usd") or 0.0)
                if meta.get("error"):
                    failed += 1
                    errors.append({"attempt_id": a.id, "message": meta["error"]})
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
        "failed": failed,
        "total_cost_usd": round(cost_sum, 6),
        "errors": errors[:20],
    }
