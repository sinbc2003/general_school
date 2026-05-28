"""검색·조회·필터 (browse) — 모든 인증 사용자."""

from fastapi import Depends, Query
from sqlalchemy import String as SaString
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.past_research import PastResearch
from app.models.user import User
from app.modules.past_research._helpers import to_item
from app.modules.past_research.router import router


@router.get("")
async def list_past_research(
    keyword: str | None = None,
    year: int | None = None,
    semester: int | None = None,
    grade: int | None = None,
    report_type: str | None = None,
    field: str | None = None,
    status: str = Query("approved", description="approved|pending|rejected|all (admin only for !=approved)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(PastResearch)
    cq = select(func.count(PastResearch.id))

    if user.role not in ("super_admin", "designated_admin") and status != "approved":
        status = "approved"

    conds = []
    if status != "all":
        conds.append(PastResearch.status == status)
    if keyword:
        kw = f"%{keyword.strip()}%"
        conds.append(or_(
            PastResearch.title.ilike(kw),
            PastResearch.original_filename.ilike(kw),
        ))
    if year is not None:
        conds.append(PastResearch.year == year)
    if semester is not None:
        conds.append(PastResearch.semester == semester)
    if grade is not None:
        conds.append(PastResearch.grade == grade)
    if report_type:
        conds.append(PastResearch.report_type == report_type)
    if field:
        conds.append(func.cast(PastResearch.fields, SaString).ilike(f"%{field}%"))

    if conds:
        q = q.where(and_(*conds))
        cq = cq.where(and_(*conds))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(
            PastResearch.year.desc(),
            PastResearch.semester.desc().nulls_last(),
            PastResearch.title,
        )
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [to_item(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/_facets")
async def get_facets(
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    years = (await db.execute(
        select(PastResearch.year).distinct().order_by(PastResearch.year.desc())
    )).scalars().all()
    types = (await db.execute(
        select(PastResearch.report_type).distinct().where(PastResearch.report_type.is_not(None))
    )).scalars().all()
    grades = (await db.execute(
        select(PastResearch.grade).distinct().where(PastResearch.grade.is_not(None)).order_by(PastResearch.grade)
    )).scalars().all()

    field_rows = (await db.execute(select(PastResearch.fields))).scalars().all()
    all_fields: set[str] = set()
    for fs in field_rows:
        for f in (fs or []):
            if isinstance(f, str) and f.strip():
                all_fields.add(f.strip())

    return {
        "years": [int(y) for y in years if y is not None],
        "report_types": sorted(t for t in types if t),
        "grades": [int(g) for g in grades if g is not None],
        "fields": sorted(all_fields),
    }
