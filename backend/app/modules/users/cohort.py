"""학년 일괄 진급 + 졸업 처리 + 졸업생 목록 (cohort 관리).

운영의 핵심 routines — 학년말마다 실행. /_cohort 접두로 /{user_id}와 충돌 회피.

router 객체는 router.py에서 공유. router.py 끝의 'from . import cohort'로 등록.
"""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.user import User
from app.modules.users.schemas import (
    CohortGraduateRequest, CohortPromoteRequest,
)

from app.modules.users.router import router
from app.modules.users._helpers import _is_admin


@router.post("/_cohort/promote")
async def promote_students(
    body: CohortPromoteRequest, request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """학년 일괄 진급. 학년 = 1, 2만 허용 (3학년 진급은 졸업 처리 사용)."""
    if not _is_admin(user):
        raise HTTPException(403, "학년 진급은 관리자만 가능합니다")
    if body.from_grade not in (1, 2) or body.to_grade != body.from_grade + 1:
        raise HTTPException(400, "from_grade는 1 또는 2, to_grade는 from_grade+1이어야 합니다 (3학년 진급은 졸업 처리 사용)")

    targets = (await db.execute(
        select(User).where(User.role == "student", User.grade == body.from_grade, User.status == "approved")
    )).scalars().all()

    if body.dry_run:
        return {"affected": len(targets), "dry_run": True}

    for u in targets:
        u.grade = body.to_grade
    await db.flush()
    await log_action(db, user, "student.promote", f"from_grade={body.from_grade} count={len(targets)}", request=request)
    return {"affected": len(targets), "dry_run": False}


@router.post("/_cohort/graduate")
async def graduate_students(
    body: CohortGraduateRequest, request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """졸업 처리. ids 우선, 없으면 from_grade(기본 3)의 모든 재학생.

    User.status = "graduated"로 변경. 데이터는 모두 보존.
    """
    if not _is_admin(user):
        raise HTTPException(403, "졸업 처리는 관리자만 가능합니다")

    q = select(User).where(User.role == "student", User.status == "approved")
    if body.ids:
        q = q.where(User.id.in_(body.ids))
    else:
        q = q.where(User.grade == (body.from_grade or 3))
    targets = (await db.execute(q)).scalars().all()

    if body.dry_run:
        return {"affected": len(targets), "dry_run": True,
                "preview_names": [u.name for u in targets[:20]]}

    for u in targets:
        u.status = "graduated"
        # graduation_year를 어딘가 기록 — User에 컬럼이 없으니 admissions.AdmissionsRecord에 의존하거나 그냥 status만 변경
    await db.flush()
    await log_action(db, user, "student.graduate", f"year={body.graduation_year} count={len(targets)}", request=request)
    return {"affected": len(targets), "dry_run": False, "graduation_year": body.graduation_year}


@router.get("/_cohort/graduates")
async def list_graduates(
    graduation_year: int | None = None,
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    """졸업생 목록 (페이지네이션 — 수년 누적 시 폭증 방지).

    graduation_year는 AdmissionsRecord.graduation_year 매칭 시도.
    """
    q = (
        select(User)
        .where(User.role == "student", User.status == "graduated")
        .order_by(User.name)
        .offset(offset).limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()

    # AdmissionsRecord 매핑
    from app.models.admissions import AdmissionsRecord
    ar_map: dict = {}
    if rows:
        ar_q = select(AdmissionsRecord).where(AdmissionsRecord.student_id.in_([u.id for u in rows]))
        if graduation_year:
            ar_q = ar_q.where(AdmissionsRecord.graduation_year == graduation_year)
        for ar in (await db.execute(ar_q)).scalars().all():
            ar_map[ar.student_id] = ar

    items = []
    for u in rows:
        ar = ar_map.get(u.id)
        if graduation_year and not ar:
            continue
        items.append({
            "id": u.id, "name": u.name, "email": u.email,
            "graduation_year": ar.graduation_year if ar else None,
            "results": ar.results if ar else None,
        })
    return {"items": items}
