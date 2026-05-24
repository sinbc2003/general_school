"""문제은행 코스웨어 — 라이브러리 검색 + 선택 출제.

- GET  /api/courseware/problems-bank/search    — Problem 라이브러리 검색 (강좌 교사용)
- POST /api/courseware/courses/{cid}/problem-sets/from-bank — problem_ids로 ProblemSet 생성

archive 모듈의 /api/archive/problems는 problem.library.view 권한 필요해
강좌 교사가 자동 보유 X. courseware 내부에 classroom.courseware.create 권한으로
동등 검색을 별도 제공.

router 객체는 router.py에서 공유. router.py 끝의 'from . import bank'로 등록.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import Course, CourseProblemSet, Problem, User
from app.modules.classroom.teachers import is_course_editor_or_admin
from app.modules.courseware.router import router


# ─────────────────────────────────────────────────────────────────────────────
# 라이브러리 검색 (강좌 교사용)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/problems-bank/search")
async def search_problems_bank(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    subject: str | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    search: str | None = None,
    only_auto_gradable: bool = Query(default=False, description="True면 자동채점 가능한 문제만"),
    user: User = Depends(require_permission("classroom.courseware.create")),
    db: AsyncSession = Depends(get_db),
):
    """Problem 라이브러리 검색 — 강좌 출제 모달의 '라이브러리에서 선택' 패널.

    auto_grader_types = {choices, exact, regex, numeric}만 필터하려면
    only_auto_gradable=True. answer_data.grader_type 검사라 JSON 연산이 필요해
    SQL where로는 못 잡고 in-Python에서 후처리.
    """
    q = select(Problem).where(Problem.is_visible == True)
    cq = select(func.count(Problem.id)).where(Problem.is_visible == True)
    if subject:
        q = q.where(Problem.subject == subject)
        cq = cq.where(Problem.subject == subject)
    if difficulty:
        q = q.where(Problem.difficulty == difficulty)
        cq = cq.where(Problem.difficulty == difficulty)
    if question_type:
        q = q.where(Problem.question_type == question_type)
        cq = cq.where(Problem.question_type == question_type)
    if search:
        like = f"%{search}%"
        q = q.where(Problem.content.ilike(like))
        cq = cq.where(Problem.content.ilike(like))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Problem.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    auto = {"choices", "exact", "regex", "numeric"}
    items: list[dict] = []
    for p in rows:
        ad = p.answer_data or {}
        grader = (ad.get("grader_type") or "").strip().lower() if isinstance(ad, dict) else ""
        if only_auto_gradable and grader not in auto:
            continue
        items.append({
            "id": p.id,
            "subject": p.subject,
            "difficulty": p.difficulty,
            "question_type": p.question_type,
            "content_preview": (p.content or "")[:200],
            "answer": p.answer,
            "answer_data": p.answer_data,
            "grader_type": grader or None,
            "tags": p.tags or [],
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return {
        "items": items,
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


# ─────────────────────────────────────────────────────────────────────────────
# bank에서 선택해 ProblemSet 생성
# ─────────────────────────────────────────────────────────────────────────────

class FromBankReq(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    problem_ids: list[int] = Field(..., min_length=1, max_length=200)
    status: str = Field(default="draft")  # draft | published
    due_date: datetime | None = None
    time_limit_seconds: int | None = Field(default=None, ge=30, le=86400)
    max_attempts: int = Field(default=1, ge=1, le=99)
    show_solution_after_due: bool = True
    settings: dict[str, Any] | None = None


@router.post("/courses/{cid}/problem-sets/from-bank")
async def create_problem_set_from_bank(
    cid: int, body: FromBankReq, request: Request,
    user: User = Depends(require_permission("classroom.courseware.create")),
    db: AsyncSession = Depends(get_db),
):
    """선택한 problem_ids로 ProblemSet 생성.

    Problem id 존재 여부 검증 후 그대로 박는다. 같은 Problem이 여러 강좌·세트에
    참조돼도 안전 (read-only). 학생 답안은 attempts 테이블에 따로 쌓이므로 충돌 X.
    """
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사·관리자만 가능")
    if body.status not in {"draft", "published"}:
        raise HTTPException(400, "status는 draft | published")

    # 모든 id 존재 + visible 검증
    rows = (await db.execute(
        select(Problem.id).where(
            Problem.id.in_(body.problem_ids),
            Problem.is_visible == True,
        )
    )).scalars().all()
    found = set(rows)
    missing = [i for i in body.problem_ids if i not in found]
    if missing:
        raise HTTPException(
            400,
            f"라이브러리에 없거나 숨김 처리된 문제: {missing[:10]} (총 {len(missing)}건)",
        )

    # 순서 보존 (body.problem_ids 그대로)
    ps = CourseProblemSet(
        course_id=cid,
        title=body.title,
        description=body.description,
        problem_ids=list(body.problem_ids),
        status=body.status,
        due_date=body.due_date,
        time_limit_seconds=body.time_limit_seconds,
        max_attempts=body.max_attempts,
        show_solution_after_due=body.show_solution_after_due,
        settings=body.settings,
        created_by=user.id,
    )
    db.add(ps)
    await db.flush()

    await log_action(
        db, user, "courseware.problem_set.from_bank",
        target=f"course:{cid} set:{ps.id} count:{len(body.problem_ids)}",
        request=request,
    )
    return {
        "id": ps.id,
        "course_id": ps.course_id,
        "title": ps.title,
        "problem_count": len(body.problem_ids),
        "status": ps.status,
    }
