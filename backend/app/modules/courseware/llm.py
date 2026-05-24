"""문제은행 코스웨어 — LLM 채점 endpoint (교사 trigger + cost preview).

학생 제출 시 자동 background 채점은 router.py의 /submit endpoint에서
asyncio.create_task로 services.llm_grader.grade_pending_for_student를 spawn.
본 파일은 교사가 명시적으로 호출하는 batch 채점 + 비용 미리보기만 제공.

router 객체는 router.py에서 공유. router.py 끝의 'from . import llm'로 등록.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    Course, CourseProblemSet, LLMModel, Problem, StudentProblemAttempt, User,
)
from app.modules.classroom.teachers import is_course_editor_or_admin
from app.modules.courseware.router import router
from app.modules.courseware.schemas import (
    LLMGradePreviewResp, LLMGradeReq, LLMGradeResultResp,
)
from app.services.courseware_grader import MANUAL_GRADER_TYPES
from app.services.llm_grader import grade_set_batch, resolve_grader_settings


# 채점 토큰 추정치 — preview cost 계산용 (보수적 상한)
_AVG_INPUT_TOKENS = 600
_AVG_OUTPUT_TOKENS = 200


@router.get("/problem-sets/{psid}/llm-grade/preview")
async def llm_grade_preview(
    psid: int,
    provider: str | None = None,
    model_id: str | None = None,
    samples: int | None = None,
    only_ungraded: bool = True,
    force: bool = False,
    user: User = Depends(require_permission("classroom.courseware.grade")),
    db: AsyncSession = Depends(get_db),
) -> LLMGradePreviewResp:
    """LLM 채점 비용 예측 — DB 변경 X.

    eligible_attempts × samples × (input/output 평균 토큰) × 단가.
    """
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사·관리자만 가능")

    # 모델 + samples 결정
    p, mid, label, samples_n = await resolve_grader_settings(db, ps, provider, model_id, samples)
    if not p or not mid:
        return LLMGradePreviewResp(
            eligible_attempts=0, provider=None, model_id=None, model_label=None,
            samples=samples_n,
            input_per_1m_usd=0.0, output_per_1m_usd=0.0, estimated_cost_usd=0.0,
        )

    # 채점 대상 카운트
    all_attempts = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == psid,
        )
    )).scalars().all()
    pids = list({a.problem_id for a in all_attempts})
    problems = (await db.execute(
        select(Problem).where(Problem.id.in_(pids))
    )).scalars().all() if pids else []
    grader_by_pid: dict[int, str] = {}
    for pr in problems:
        ad = pr.answer_data or {}
        grader_by_pid[pr.id] = (ad.get("grader_type") or "").lower() if isinstance(ad, dict) else ""

    eligible = 0
    for a in all_attempts:
        grader = grader_by_pid.get(a.problem_id, "")
        if grader not in MANUAL_GRADER_TYPES:
            continue
        if not force and only_ungraded and a.manual_score is not None:
            continue
        eligible += 1

    # 단가
    m = (await db.execute(
        select(LLMModel).where(LLMModel.provider == p, LLMModel.model_id == mid)
    )).scalar_one_or_none()
    in_rate = m.input_per_1m_usd if m else 0.0
    out_rate = m.output_per_1m_usd if m else 0.0

    est = eligible * samples_n * (
        (_AVG_INPUT_TOKENS / 1_000_000) * in_rate
        + (_AVG_OUTPUT_TOKENS / 1_000_000) * out_rate
    )
    return LLMGradePreviewResp(
        eligible_attempts=eligible,
        provider=p, model_id=mid, model_label=label,
        samples=samples_n,
        input_per_1m_usd=in_rate, output_per_1m_usd=out_rate,
        estimated_cost_usd=round(est, 6),
    )


@router.post("/problem-sets/{psid}/llm-grade")
async def llm_grade_batch(
    psid: int, body: LLMGradeReq, request: Request,
    user: User = Depends(require_permission("classroom.courseware.grade")),
    db: AsyncSession = Depends(get_db),
) -> LLMGradeResultResp:
    """LLM 일괄 채점 — 동기 (1~3분 소요 가능).

    completes 후 students/문제별 결과 페이지에서 reload하면 점수 반영됨.
    """
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사·관리자만 가능")

    result = await grade_set_batch(
        db, psid,
        provider=body.provider, model_id=body.model_id, samples=body.samples,
        only_ungraded=body.only_ungraded, force=body.force,
    )

    await log_action(
        db, user, "courseware.llm_grade.batch",
        target=f"set:{psid}",
        detail=(
            f"total:{result['total']} graded:{result['graded']} "
            f"needs_review:{result.get('needs_review', 0)} failed:{result['failed']} "
            f"samples:{result.get('samples', 1)} cost:${result['total_cost_usd']:.4f}"
        ),
        is_sensitive=True,
        request=request,
    )
    return LLMGradeResultResp(**result)
