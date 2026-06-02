"""검색·조회·필터 (browse) — 모든 인증 사용자."""

import os

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse
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


@router.get("/{rid}/file")
async def serve_past_research_file(
    rid: int,
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    """보고서 PDF 서빙 — 미리보기(inline)·다운로드 공통. past_research.view 권한자.

    file_url(절대경로 기반)이 환경(STORAGE_ROOT 절대경로)에서 깨지는 문제를 우회 —
    id로 stored_path를 직접 서빙. 렌더링은 클라이언트 브라우저(서버 부담 없음).
    """
    p = (await db.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "보고서를 찾을 수 없습니다")
    if p.status != "approved" and user.role not in ("super_admin", "designated_admin"):
        raise HTTPException(403, "접근 권한이 없습니다")
    if not p.stored_path or not os.path.isfile(p.stored_path):
        raise HTTPException(404, "파일이 존재하지 않습니다")
    return FileResponse(
        p.stored_path,
        media_type="application/pdf",
        filename=p.original_filename or f"research_{rid}.pdf",
        content_disposition_type="inline",
    )


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
