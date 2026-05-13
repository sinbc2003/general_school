"""대회 라우터 — 대회 CRUD, 참가자, 문제, 제출"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.auth import get_current_user
from app.core.semester import (
    get_active_semester_id_or_404,
    resolve_semester_id,
)
from app.models.contest import (
    Contest, ContestStatus, ContestProblem, ContestParticipant,
    ContestTeam, ContestSubmission,
)
from app.models.user import User
from app.modules.contest.schemas import ContestCreate, ContestUpdate

router = APIRouter(prefix="/api/contest", tags=["contest"])


async def _get_contest(db: AsyncSession, cid: int) -> Contest:
    c = (await db.execute(select(Contest).where(Contest.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "대회를 찾을 수 없습니다")
    return c


# ── Contest CRUD ──

@router.post("")
async def create_contest(
    body: ContestCreate,
    user: User = Depends(require_permission("contest.manage.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sid = await resolve_semester_id({"semester_id": body.semester_id} if body.semester_id else None, db)
    c = Contest(
        semester_id=sid,
        title=body.title,
        description=body.description,
        contest_type=body.contest_type,
        rules=body.rules,
        start_at=body.start_at,
        end_at=body.end_at,
        is_visible=body.is_visible,
        created_by_id=user.id,
    )
    db.add(c)
    await db.flush()
    await log_action(db, user, "contest.create", f"contest:{c.id}", request=request)
    return {"id": c.id, "title": c.title, "semester_id": sid}


@router.get("")
async def list_contests(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(require_permission("contest.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    # 학기 필터: 명시 안 하면 현재 학기 (대회는 학기 격리)
    sid = semester_id or await get_active_semester_id_or_404(db)
    q = select(Contest).where(Contest.semester_id == sid)
    cq = select(func.count(Contest.id)).where(Contest.semester_id == sid)
    # 학생은 visible만
    if user.role == "student":
        q = q.where(Contest.is_visible == True)
        cq = cq.where(Contest.is_visible == True)
    if status:
        q = q.where(Contest.status == status)
        cq = cq.where(Contest.status == status)

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Contest.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    # participant counts
    if rows:
        ids = [c.id for c in rows]
        pc = dict((await db.execute(
            select(ContestParticipant.contest_id, func.count(ContestParticipant.id))
            .where(ContestParticipant.contest_id.in_(ids))
            .group_by(ContestParticipant.contest_id)
        )).all())
    else:
        pc = {}

    return {
        "items": [
            {
                "id": c.id, "title": c.title, "contest_type": c.contest_type,
                "status": c.status.value, "is_visible": c.is_visible,
                "start_at": c.start_at.isoformat() if c.start_at else None,
                "end_at": c.end_at.isoformat() if c.end_at else None,
                "participant_count": pc.get(c.id, 0),
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in rows
        ],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{cid}")
async def get_contest(
    cid: int,
    user: User = Depends(require_permission("contest.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    c = await _get_contest(db, cid)
    return {
        "id": c.id, "title": c.title, "description": c.description,
        "contest_type": c.contest_type, "status": c.status.value,
        "rules": c.rules, "is_visible": c.is_visible, "extra": c.extra,
        "start_at": c.start_at.isoformat() if c.start_at else None,
        "end_at": c.end_at.isoformat() if c.end_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.put("/{cid}")
async def update_contest(
    cid: int, body: ContestUpdate,
    user: User = Depends(require_permission("contest.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    c = await _get_contest(db, cid)
    data = body.model_dump(exclude_unset=True)
    for f in ["title", "description", "contest_type", "rules", "start_at", "end_at", "is_visible", "extra"]:
        if f in data:
            setattr(c, f, data[f])
    if "status" in data and data["status"]:
        c.status = ContestStatus(data["status"])
    await db.flush()
    await log_action(db, user, "contest.update", f"contest:{cid}", request=request)
    return {"ok": True}


@router.delete("/{cid}")
async def delete_contest(
    cid: int,
    user: User = Depends(require_permission("contest.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    c = await _get_contest(db, cid)
    await db.delete(c)
    await log_action(db, user, "contest.delete", f"contest:{cid}", request=request)
    return {"ok": True}


# ── Problems ──

@router.get("/{cid}/problems")
async def list_contest_problems(
    cid: int,
    user: User = Depends(require_permission("contest.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ContestProblem)
        .where(ContestProblem.contest_id == cid)
        .order_by(ContestProblem.problem_number)
    )).scalars().all()
    show_answer = user.role in ("super_admin", "designated_admin", "teacher")
    return [
        {
            "id": p.id, "problem_number": p.problem_number,
            "content": p.content, "points": p.points,
            "answer": p.answer if show_answer else None,
        }
        for p in rows
    ]


@router.post("/{cid}/problems")
async def add_contest_problem(
    cid: int, body: dict,
    user: User = Depends(require_permission("contest.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    await _get_contest(db, cid)
    p = ContestProblem(
        contest_id=cid,
        problem_number=body["problem_number"],
        content=body["content"],
        answer=body.get("answer"),
        points=body.get("points", 10),
    )
    db.add(p)
    await db.flush()
    return {"id": p.id}


# ── Participants ──

@router.get("/{cid}/participants")
async def list_participants(
    cid: int,
    user: User = Depends(require_permission("contest.manage.teams")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ContestParticipant, User.name, User.email)
        .join(User, User.id == ContestParticipant.user_id)
        .where(ContestParticipant.contest_id == cid)
    )).all()
    return [
        {
            "id": r[0].id, "user_id": r[0].user_id,
            "name": r[1], "email": r[2],
            "score": r[0].score, "rank": r[0].rank,
        }
        for r in rows
    ]


@router.post("/{cid}/participants")
async def add_participant(
    cid: int, body: dict,
    user: User = Depends(require_permission("contest.manage.teams")),
    db: AsyncSession = Depends(get_db),
):
    p = ContestParticipant(contest_id=cid, user_id=body["user_id"])
    db.add(p)
    await db.flush()
    return {"id": p.id}


# ── Submissions (학생) ──

@router.post("/{cid}/submissions")
async def submit_to_contest(
    cid: int, body: dict,
    user: User = Depends(require_permission("contest.participate.submit")),
    db: AsyncSession = Depends(get_db),
):
    s = ContestSubmission(
        contest_id=cid,
        user_id=user.id,
        content=body.get("content"),
        file_path=body.get("file_path"),
    )
    db.add(s)
    await db.flush()
    return {"id": s.id}


@router.get("/{cid}/submissions")
async def list_submissions(
    cid: int,
    user: User = Depends(require_permission("contest.manage.results")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ContestSubmission, User.name)
        .join(User, User.id == ContestSubmission.user_id)
        .where(ContestSubmission.contest_id == cid)
        .order_by(desc(ContestSubmission.submitted_at))
    )).all()
    return [
        {
            "id": s[0].id, "user_id": s[0].user_id, "name": s[1],
            "content": s[0].content, "score": s[0].score,
            "submitted_at": s[0].submitted_at.isoformat() if s[0].submitted_at else None,
        }
        for s in rows
    ]
