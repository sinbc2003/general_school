"""진학 라우터 — 기출문제, 진학기록, 학생응답"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.admissions import AdmissionsQuestion, AdmissionsRecord, AdmissionsResponse
from app.models.user import User

router = APIRouter(prefix="/api/admissions", tags=["admissions"])


# ── Questions ──

@router.post("/questions")
async def create_question(
    body: dict,
    user: User = Depends(require_permission("admissions.question.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    q = AdmissionsQuestion(
        university=body["university"], department=body.get("department"),
        admission_type=body["admission_type"],
        question_type=body["question_type"], year=body["year"],
        content=body["content"], solution=body.get("solution"),
        subject=body.get("subject"), tags=body.get("tags"),
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
    qid: int, body: dict,
    user: User = Depends(require_permission("admissions.question.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    q = (await db.execute(select(AdmissionsQuestion).where(AdmissionsQuestion.id == qid))).scalar_one_or_none()
    if not q:
        raise HTTPException(404)
    for f in ["university", "department", "admission_type", "question_type",
              "year", "content", "solution", "subject", "tags"]:
        if f in body:
            setattr(q, f, body[f])
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
    body: dict,
    user: User = Depends(require_permission("admissions.record.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    r = AdmissionsRecord(
        student_id=body["student_id"], graduation_year=body["graduation_year"],
        results=body.get("results"), portfolio_summary=body.get("portfolio_summary"),
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


# ── Responses (학생 연습) ──

@router.post("/questions/{qid}/respond")
async def submit_response(
    qid: int, body: dict,
    user: User = Depends(require_permission("admissions.question.view")),
    db: AsyncSession = Depends(get_db),
):
    r = AdmissionsResponse(question_id=qid, user_id=user.id, response=body["response"])
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
