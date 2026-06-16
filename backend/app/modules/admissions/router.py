"""진학 라우터 — 기출문제, 진학기록, 학생응답"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.admissions import AdmissionsQuestion, AdmissionsRecord, AdmissionsResponse
from app.models.user import User
from app.modules.admissions.schemas import (
    AdmissionsQuestionCreate, AdmissionsQuestionUpdate,
    AdmissionsRecommendReq, AdmissionsRecordCreate, AdmissionsResponseSubmit,
)

router = APIRouter(prefix="/api/admissions", tags=["admissions"])


# ── Questions ──

@router.post("/questions")
async def create_question(
    body: AdmissionsQuestionCreate,
    user: User = Depends(require_permission("admissions.question.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    q = AdmissionsQuestion(
        university=body.university, department=body.department,
        admission_type=body.admission_type,
        question_type=body.question_type, year=body.year,
        content=body.content, solution=body.solution,
        subject=body.subject, tags=body.tags,
    )
    db.add(q)
    await db.flush()
    await log_action(db, user, "admissions.question.create", f"question:{q.id}", request=request)
    return {"id": q.id}


@router.get("/questions")
async def list_questions(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    university: str | None = None, year: int | None = None,
    question_type: str | None = None, search: str | None = None,
    user: User = Depends(require_permission("admissions.question.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdmissionsQuestion)
    cq = select(func.count(AdmissionsQuestion.id))
    if university:
        q = q.where(AdmissionsQuestion.university == university)
        cq = cq.where(AdmissionsQuestion.university == university)
    if year:
        q = q.where(AdmissionsQuestion.year == year)
        cq = cq.where(AdmissionsQuestion.year == year)
    if question_type:
        q = q.where(AdmissionsQuestion.question_type == question_type)
        cq = cq.where(AdmissionsQuestion.question_type == question_type)
    if search:
        q = q.where(AdmissionsQuestion.content.contains(search))
        cq = cq.where(AdmissionsQuestion.content.contains(search))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(AdmissionsQuestion.year), AdmissionsQuestion.university)
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": r.id, "university": r.university, "department": r.department,
            "admission_type": r.admission_type, "question_type": r.question_type,
            "year": r.year, "content": r.content[:200], "subject": r.subject,
        } for r in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/questions/{qid}")
async def get_question(
    qid: int,
    user: User = Depends(require_permission("admissions.question.view")),
    db: AsyncSession = Depends(get_db),
):
    q = (await db.execute(select(AdmissionsQuestion).where(AdmissionsQuestion.id == qid))).scalar_one_or_none()
    if not q:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    return {
        "id": q.id, "university": q.university, "department": q.department,
        "admission_type": q.admission_type, "question_type": q.question_type,
        "year": q.year, "content": q.content, "solution": q.solution,
        "subject": q.subject, "tags": q.tags,
    }


@router.put("/questions/{qid}")
async def update_question(
    qid: int, body: AdmissionsQuestionUpdate,
    user: User = Depends(require_permission("admissions.question.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    q = (await db.execute(select(AdmissionsQuestion).where(AdmissionsQuestion.id == qid))).scalar_one_or_none()
    if not q:
        raise HTTPException(404)
    patch = body.model_dump(exclude_unset=True)
    for f, v in patch.items():
        setattr(q, f, v)
    await db.flush()
    await log_action(db, user, "admissions.question.update", f"question:{qid}", request=request)
    return {"ok": True}


@router.delete("/questions/{qid}")
async def delete_question(
    qid: int,
    user: User = Depends(require_permission("admissions.question.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    q = (await db.execute(select(AdmissionsQuestion).where(AdmissionsQuestion.id == qid))).scalar_one_or_none()
    if not q:
        raise HTTPException(404)
    await db.delete(q)
    await log_action(db, user, "admissions.question.delete", f"question:{qid}", request=request)
    return {"ok": True}


# ── Records (관리자) ──

@router.post("/records")
async def create_record(
    body: AdmissionsRecordCreate,
    user: User = Depends(require_permission("admissions.record.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    r = AdmissionsRecord(
        student_id=body.student_id, graduation_year=body.graduation_year,
        results=body.results, portfolio_summary=body.portfolio_summary,
        created_by_id=user.id,
    )
    db.add(r)
    await db.flush()
    await log_action(db, user, "admissions.record.create", f"record:{r.id}", request=request, is_sensitive=True)
    return {"id": r.id}


@router.get("/records")
async def list_records(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    graduation_year: int | None = None,
    user: User = Depends(require_permission("admissions.record.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdmissionsRecord)
    cq = select(func.count(AdmissionsRecord.id))
    if graduation_year:
        q = q.where(AdmissionsRecord.graduation_year == graduation_year)
        cq = cq.where(AdmissionsRecord.graduation_year == graduation_year)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(AdmissionsRecord.graduation_year))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": r.id, "student_id": r.student_id,
            "graduation_year": r.graduation_year, "results": r.results,
        } for r in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


# ── Analysis (합격 분석 — 학교 진학기록 집계) ──

def _is_accepted(status: str) -> bool:
    s = (status or "").strip().lower()
    return (
        s in ("accepted", "합격", "최초합격", "추가합격", "합")
        or s.startswith("합격") or "최초합" in s or "추합" in s
    )


@router.get("/analysis")
async def admissions_analysis(
    user: User = Depends(require_permission("admissions.analysis.view")),
    db: AsyncSession = Depends(get_db),
):
    """학교 진학기록(AdmissionsRecord.results) 집계 — 대학별/연도별/전형별 합격 현황.

    results는 자유형식 JSON이라 방어적으로 파싱한다 (list[dict] 가정, dict 단건도 허용).
    각 entry: {university, admission_type|type, result|status}.
    """
    records = (await db.execute(select(AdmissionsRecord))).scalars().all()

    by_uni: dict[str, dict] = {}
    by_year: dict[int, dict] = {}
    by_type: dict[str, dict] = {}

    def _bump(bucket: dict, key, accepted: bool):
        b = bucket.setdefault(key, {"applied": 0, "accepted": 0})
        b["applied"] += 1
        if accepted:
            b["accepted"] += 1

    for rec in records:
        results = rec.results
        if isinstance(results, dict):
            results = [results]
        if not isinstance(results, list):
            continue
        for entry in results:
            if not isinstance(entry, dict):
                continue
            uni = (entry.get("university") or "").strip()
            atype = (entry.get("admission_type") or entry.get("type") or "기타").strip() or "기타"
            status = str(entry.get("result") or entry.get("status") or "")
            acc = _is_accepted(status)
            _bump(by_year, rec.graduation_year, acc)
            _bump(by_type, atype, acc)
            if uni:
                _bump(by_uni, uni, acc)

    def _rate(v: dict) -> float:
        return round(v["accepted"] / v["applied"] * 100, 1) if v["applied"] else 0.0

    universities = sorted(
        [{"university": k, "applied": v["applied"], "accepted": v["accepted"], "rate": _rate(v)}
         for k, v in by_uni.items()],
        key=lambda x: (-x["accepted"], -x["applied"]),
    )
    years = sorted(
        [{"year": k, "applied": v["applied"], "accepted": v["accepted"], "rate": _rate(v)}
         for k, v in by_year.items()],
        key=lambda x: x["year"],
    )
    admission_types = sorted(
        [{"admission_type": k, "applied": v["applied"], "accepted": v["accepted"], "rate": _rate(v)}
         for k, v in by_type.items()],
        key=lambda x: -x["applied"],
    )
    total_applied = sum(v["applied"] for v in by_year.values())
    total_accepted = sum(v["accepted"] for v in by_year.values())

    return {
        "record_count": len(records),
        "total_applied": total_applied,
        "total_accepted": total_accepted,
        "overall_rate": round(total_accepted / total_applied * 100, 1) if total_applied else 0.0,
        "universities": universities,
        "years": years,
        "admission_types": admission_types,
    }


# ── Responses (학생 연습) ──

@router.post("/questions/{qid}/respond")
async def submit_response(
    qid: int, body: AdmissionsResponseSubmit,
    user: User = Depends(require_permission("admissions.question.view")),
    db: AsyncSession = Depends(get_db),
):
    r = AdmissionsResponse(question_id=qid, user_id=user.id, response=body.response)
    db.add(r)
    await db.flush()
    return {"id": r.id}


@router.get("/questions/{qid}/responses")
async def list_responses(
    qid: int,
    user: User = Depends(require_permission("admissions.question.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(AdmissionsResponse).where(AdmissionsResponse.question_id == qid)
    if user.role == "student":
        q = q.where(AdmissionsResponse.user_id == user.id)
    rows = (await db.execute(q.order_by(desc(AdmissionsResponse.created_at)))).scalars().all()
    return [{
        "id": r.id, "user_id": r.user_id, "response": r.response,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]


# ── AI 대학 추천 (진학설계) ──

_RECOMMEND_SYSTEM = (
    "당신은 대한민국 대학입시 진학지도 전문가입니다. 학생의 내신·모의고사·수상·진로희망을 "
    "바탕으로 지원 가능한 대학을 추천합니다.\n"
    "규칙:\n"
    "- 상향/적정/안정 3단계로 구분해 각 단계에 대학·학과·전형(수시/정시)을 4~6개 제시.\n"
    "- 각 추천에 '왜 추천하는지' 근거를 학생 데이터에 기반해 1줄로 설명.\n"
    "- 내신·모의고사 등급을 보고 현실적으로 추천(과도한 상향/하향 금지). 등급이 좋을수록 상위권.\n"
    "- 자료가 부족하면 그 사실을 명시하고 일반적 가이드만 제공. 없는 사실을 지어내지 말 것.\n"
    "- 마크다운으로 출력: '## 상향 / ## 적정 / ## 안정' 섹션, 각 항목은 "
    "'- **대학 학과** (전형): 근거' 형식. 마지막에 '## 종합 조언' 2~3문장."
)


async def _build_student_profile(db: AsyncSession, student: User) -> str:
    """학생 내신·모의고사·수상·진로희망을 LLM 입력 텍스트로 구성."""
    from app.models.portfolio import StudentAward, StudentGrade, StudentMockExam
    from app.models.student_self import StudentCareerPlan

    sid = student.id
    parts = [f"학생: {student.name} ({student.grade or '?'}학년)"]

    grades = (await db.execute(
        select(StudentGrade).where(StudentGrade.student_id == sid)
        .order_by(StudentGrade.year.desc(), StudentGrade.semester.desc()).limit(40)
    )).scalars().all()
    if grades:
        lines = [
            f"  {g.year}-{g.semester} {g.subject}: {g.score}/{g.max_score}"
            + (f" 석차{g.grade_rank}" if g.grade_rank else "")
            for g in grades
        ]
        parts.append("[내신 성적]\n" + "\n".join(lines))

    mocks = (await db.execute(
        select(StudentMockExam).where(StudentMockExam.student_id == sid)
        .order_by(StudentMockExam.id.desc()).limit(20)
    )).scalars().all()
    if mocks:
        lines = [
            f"  {m.subject}: {m.grade_level}등급" + (f" (백분위 {m.percentile})" if m.percentile is not None else "")
            for m in mocks
        ]
        parts.append("[모의고사]\n" + "\n".join(lines))

    awards = (await db.execute(
        select(StudentAward).where(StudentAward.student_id == sid)
        .order_by(StudentAward.award_date.desc()).limit(20)
    )).scalars().all()
    if awards:
        parts.append("[수상]\n" + "\n".join(f"  {a.title} ({a.category}, {a.award_level})" for a in awards))

    plan = (await db.execute(
        select(StudentCareerPlan).where(StudentCareerPlan.student_id == sid)
        .order_by(StudentCareerPlan.id.desc())
    )).scalars().first()
    if plan:
        cp = []
        if plan.desired_field:
            cp.append(f"희망분야: {plan.desired_field}")
        if plan.career_goal:
            cp.append(f"장래희망: {plan.career_goal}")
        if plan.target_majors:
            tm = ", ".join(
                f"{t.get('university', '')} {t.get('major', '')}".strip()
                for t in plan.target_majors if isinstance(t, dict)
            )
            if tm:
                cp.append(f"목표대학: {tm}")
        if cp:
            parts.append("[진로희망]\n  " + " / ".join(cp))

    return "\n\n".join(parts)


async def _adm_cfg(db: AsyncSession, key: str) -> str | None:
    from app.models.chatbot import ChatbotConfig
    row = (await db.execute(select(ChatbotConfig).where(ChatbotConfig.key == key))).scalar_one_or_none()
    return row.value if row else None


@router.post("/recommend")
async def recommend_universities(
    body: AdmissionsRecommendReq,
    request: Request,
    user: User = Depends(require_permission("admissions.record.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 데이터 기반 AI 대학 추천 (상향/적정/안정 + 근거).

    학교 LLM(챗봇) 인프라 재사용. 모델 미지정 시 챗봇 기본 모델(default_*_teacher).
    """
    from app.core.visibility import assert_can_view_student
    from app.models.chatbot import LLMModel
    from app.services.llm.base import LLMMessage
    from app.services.llm.registry import get_adapter

    student = await db.get(User, body.student_id)
    if not student or student.role != "student":
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    provider = body.provider or await _adm_cfg(db, "default_provider_teacher")
    model_id = body.model_id or await _adm_cfg(db, "default_model_teacher")
    if not provider or not model_id:
        raise HTTPException(400, "AI 모델이 지정되지 않았습니다. /system/llm/config에서 기본 모델을 설정하세요.")

    # 민감 데이터(성적) 접근 — visibility 가드
    await assert_can_view_student(db, user, body.student_id)

    adapter = await get_adapter(db, provider)
    if adapter is None:
        raise HTTPException(400, f"'{provider}' API 키가 등록/활성화되지 않았습니다.")

    profile = await _build_student_profile(db, student)
    user_text = profile
    if body.note:
        user_text += f"\n\n[교사 추가 메모]\n{body.note.strip()[:1000]}"

    full, ti, to, err = "", 0, 0, None
    try:
        async for chunk in adapter.chat_stream(
            model=model_id,
            messages=[LLMMessage(role="user", content=user_text)],
            system=_RECOMMEND_SYSTEM,
            max_tokens=2000,
            temperature=0.5,
        ):
            if chunk.error:
                err = chunk.error
            if chunk.delta:
                full += chunk.delta
            if chunk.done:
                ti, to = chunk.input_tokens, chunk.output_tokens
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}"
    if err and not full:
        raise HTTPException(502, f"추천 생성 실패: {err}")

    m = (await db.execute(
        select(LLMModel).where(LLMModel.provider == provider, LLMModel.model_id == model_id)
    )).scalar_one_or_none()
    cost = (ti / 1_000_000) * (m.input_per_1m_usd if m else 0.0) + (to / 1_000_000) * (m.output_per_1m_usd if m else 0.0)

    await log_action(
        db, user, "admissions.recommend",
        f"student:{body.student_id}", request=request, is_sensitive=True,
    )
    return {
        "student_name": student.name,
        "recommendation": full.strip(),
        "cost_usd": round(cost, 4),
        "has_profile": bool(profile and "[" in profile),
    }
