"""동아리 라우터 — 동아리, 활동, 제출"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import (
    get_active_semester_id_or_404,
    resolve_semester_id,
    get_semester_by_id_or_404,
)
from app.models.club import Club, ClubActivity, ClubSubmission
from app.models.user import User

router = APIRouter(prefix="/api/club", tags=["club"])


@router.post("")
async def create_club(
    body: dict,
    user: User = Depends(require_permission("club.manage.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sid = await resolve_semester_id(body, db)
    # year는 학기에서 추출 (호환을 위해 채워둠)
    sem = await get_semester_by_id_or_404(db, sid)
    c = Club(
        semester_id=sid,
        name=body["name"], description=body.get("description"),
        advisor_id=body.get("advisor_id"), members=body.get("members"),
        year=body.get("year") or sem.year, budget=body.get("budget"),
    )
    db.add(c)
    await db.flush()
    await log_action(db, user, "club.create", f"club:{c.id}", request=request)
    return {"id": c.id, "name": c.name, "semester_id": sid}


@router.get("")
async def list_clubs(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    year: int | None = None,
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    sid = semester_id or await get_active_semester_id_or_404(db)
    q = select(Club).where(Club.semester_id == sid)
    cq = select(func.count(Club.id)).where(Club.semester_id == sid)
    if year:
        q = q.where(Club.year == year)
        cq = cq.where(Club.year == year)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Club.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": c.id, "name": c.name, "year": c.year,
            "status": c.status, "members": c.members,
        } for c in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{cid}")
async def get_club(
    cid: int,
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    c = (await db.execute(select(Club).where(Club.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "동아리를 찾을 수 없습니다")
    return {
        "id": c.id, "name": c.name, "description": c.description,
        "year": c.year, "status": c.status, "members": c.members,
        "budget": c.budget,
    }


@router.put("/{cid}")
async def update_club(
    cid: int, body: dict,
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    c = (await db.execute(select(Club).where(Club.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404)
    for f in ["name", "description", "members", "status", "budget"]:
        if f in body:
            setattr(c, f, body[f])
    await db.flush()
    await log_action(db, user, "club.update", f"club:{cid}", request=request)
    return {"ok": True}


# ── Activities ──

@router.post("/{cid}/activities")
async def create_activity(
    cid: int, body: dict,
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    a = ClubActivity(
        club_id=cid, title=body["title"], content=body["content"],
        activity_date=body["activity_date"],
        attendees=body.get("attendees"), created_by_id=user.id,
    )
    db.add(a)
    await db.flush()
    return {"id": a.id}


@router.get("/{cid}/activities")
async def list_activities(
    cid: int,
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ClubActivity).where(ClubActivity.club_id == cid)
        .order_by(desc(ClubActivity.activity_date))
    )).scalars().all()
    return [{
        "id": a.id, "title": a.title, "content": a.content,
        "activity_date": a.activity_date.isoformat() if a.activity_date else None,
        "attendees": a.attendees,
    } for a in rows]


# ── Submissions (학생) ──

@router.post("/{cid}/submissions")
async def create_submission(
    cid: int, body: dict,
    user: User = Depends(require_permission("club.submission.upload")),
    db: AsyncSession = Depends(get_db),
):
    s = ClubSubmission(
        club_id=cid, author_id=user.id,
        title=body["title"], submission_type=body["submission_type"],
        file_path=body.get("file_path"),
    )
    db.add(s)
    await db.flush()
    return {"id": s.id}


@router.get("/{cid}/submissions")
async def list_submissions(
    cid: int,
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ClubSubmission, User.name)
        .join(User, User.id == ClubSubmission.author_id)
        .where(ClubSubmission.club_id == cid)
        .order_by(desc(ClubSubmission.created_at))
    )).all()
    return [{
        "id": s[0].id, "author_id": s[0].author_id, "name": s[1],
        "title": s[0].title, "submission_type": s[0].submission_type,
        "created_at": s[0].created_at.isoformat() if s[0].created_at else None,
    } for s in rows]
