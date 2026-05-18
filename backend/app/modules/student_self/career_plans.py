"""학생 본인 진로/진학 설계 endpoints.

학기당 1개의 active plan + (legacy) 다년 모드용 list/create/delete.

router 객체는 router.py에서 공유. router.py 끝의 'from . import career_plans'로 등록.
"""

from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_self import StudentCareerPlan
from app.models.user import User
from app.modules.student_self.schemas import (
    CareerPlanCreate, CareerPlanUpdate, CareerPlanUpsert,
)

from app.modules.student_self.router import router
from app.modules.student_self._helpers import _plan_to_dict, _require_student


@router.get("/career-plans")
async def list_my_career_plans(
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    rows = (await db.execute(
        select(StudentCareerPlan).where(StudentCareerPlan.student_id == user.id)
        .order_by(desc(StudentCareerPlan.year), desc(StudentCareerPlan.updated_at))
    )).scalars().all()
    return {"items": [_plan_to_dict(p) for p in rows]}


@router.get("/career-plans/active")
async def get_my_active_career_plan(
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    """현재 학기의 진로 계획. 없으면 null (UI는 그때 빈 폼)."""
    from app.core.semester import get_current_semester
    _require_student(user)
    sem = await get_current_semester(db)
    if not sem:
        return {"plan": None, "semester": None}
    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.student_id == user.id,
            StudentCareerPlan.semester_id == sem.id,
        )
    )).scalar_one_or_none()
    return {
        "plan": _plan_to_dict(p) if p else None,
        "semester": {"id": sem.id, "year": sem.year, "semester": sem.semester, "name": sem.name},
    }


@router.put("/career-plans/active")
async def upsert_my_active_career_plan(
    body: CareerPlanUpsert, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    """현재 학기의 진로 계획 upsert. 학기당 1개 = 학기 안에서 항상 수정."""
    from app.core.semester import get_current_semester
    _require_student(user)
    sem = await get_current_semester(db)
    if not sem:
        raise HTTPException(400, "현재 학기가 설정되지 않았습니다 (관리자가 학기를 활성화해야 함)")

    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.student_id == user.id,
            StudentCareerPlan.semester_id == sem.id,
        )
    )).scalar_one_or_none()

    if not p:
        p = StudentCareerPlan(
            student_id=user.id,
            semester_id=sem.id,
            year=sem.year,
        )
        db.add(p)

    patch = body.model_dump(exclude_unset=True)
    for f, v in patch.items():
        setattr(p, f, v)

    await db.flush()
    await log_action(
        db, user, "student_career.upsert_active",
        target=f"semester:{sem.id}", request=request,
    )
    return _plan_to_dict(p)


@router.post("/career-plans")
async def create_career_plan(
    body: CareerPlanCreate, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    year = body.year or datetime.now().year
    p = StudentCareerPlan(
        student_id=user.id, year=year,
        desired_field=body.desired_field,
        career_goal=body.career_goal,
        target_universities=body.target_universities or [],
        target_majors=body.target_majors or [],
        academic_plan=body.academic_plan,
        activity_plan=body.activity_plan,
        semester_goals=body.semester_goals or [],
        motivation=body.motivation,
        notes=body.notes,
    )
    db.add(p)
    await db.flush()
    await log_action(db, user, "student_career.create", target=f"year:{year}", request=request)
    return _plan_to_dict(p)


@router.put("/career-plans/{pid}")
async def update_career_plan(
    pid: int, body: CareerPlanUpdate, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.id == pid, StudentCareerPlan.student_id == user.id
        )
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    patch = body.model_dump(exclude_unset=True)
    for f, v in patch.items():
        setattr(p, f, v)
    await log_action(db, user, "student_career.update", target=f"id:{pid}", request=request)
    return _plan_to_dict(p)


@router.delete("/career-plans/{pid}")
async def delete_career_plan(
    pid: int, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.id == pid, StudentCareerPlan.student_id == user.id
        )
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    await db.delete(p)
    await log_action(db, user, "student_career.delete", target=f"id:{pid}", request=request)
    return {"ok": True}
