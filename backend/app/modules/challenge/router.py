"""챌린지 라우터 — 레벨, 문제, 진행"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.challenge import ChallengeLevel, ChallengeProblem, ChallengeProgress
from app.models.user import User

router = APIRouter(prefix="/api/challenge", tags=["challenge"])


# ── Admin: Level/Problem CRUD ──

@router.post("/levels")
async def create_level(
    body: dict,
    user: User = Depends(require_permission("challenge.level.manage")),
    db: AsyncSession = Depends(get_db),
):
    lv = ChallengeLevel(
        category=body["category"], title=body["title"],
        level_number=body["level_number"],
        unlock_threshold=body.get("unlock_threshold", 70),
    )
    db.add(lv)
    await db.flush()
    return {"id": lv.id}


@router.get("/levels")
async def list_levels(
    category: str | None = None,
    user: User = Depends(require_permission("challenge.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(ChallengeLevel)
    if user.role == "student":
        q = q.where(ChallengeLevel.is_visible == True)
    if category:
        q = q.where(ChallengeLevel.category == category)
    rows = (await db.execute(q.order_by(ChallengeLevel.category, ChallengeLevel.level_number))).scalars().all()

    # problem count per level
    if rows:
        ids = [lv.id for lv in rows]
        pc = dict((await db.execute(
            select(ChallengeProblem.level_id, func.count(ChallengeProblem.id))
            .where(ChallengeProblem.level_id.in_(ids))
            .group_by(ChallengeProblem.level_id)
        )).all())
    else:
        pc = {}

    return [{
        "id": lv.id, "category": lv.category, "title": lv.title,
        "level_number": lv.level_number,
        "unlock_threshold": lv.unlock_threshold,
        "problem_count": pc.get(lv.id, 0),
    } for lv in rows]


@router.post("/levels/{lid}/problems")
async def add_problem(
    lid: int, body: dict,
    user: User = Depends(require_permission("challenge.problem.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = ChallengeProblem(
        level_id=lid, content=body["content"],
        solution=body.get("solution"), difficulty=body["difficulty"],
        source_name=body.get("source_name"),
        order=body.get("order", 0), points=body.get("points", 10),
    )
    db.add(p)
    await db.flush()
    return {"id": p.id}


@router.get("/levels/{lid}/problems")
async def list_problems(
    lid: int,
    user: User = Depends(require_permission("challenge.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(ChallengeProblem).where(ChallengeProblem.level_id == lid)
    if user.role == "student":
        q = q.where(ChallengeProblem.is_visible == True)
    rows = (await db.execute(q.order_by(ChallengeProblem.order))).scalars().all()
    show_solution = user.role in ("super_admin", "designated_admin", "teacher")
    return [{
        "id": p.id, "content": p.content, "difficulty": p.difficulty,
        "source_name": p.source_name, "points": p.points,
        "solution": p.solution if show_solution else None,
    } for p in rows]


# ── Student Progress ──

@router.post("/problems/{pid}/solve")
async def solve_problem(
    pid: int, body: dict,
    user: User = Depends(require_permission("challenge.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    prog = (await db.execute(
        select(ChallengeProgress)
        .where(ChallengeProgress.user_id == user.id, ChallengeProgress.problem_id == pid)
    )).scalar_one_or_none()
    if not prog:
        prog = ChallengeProgress(user_id=user.id, problem_id=pid)
        db.add(prog)
    prog.status = body.get("status", "completed")
    prog.score = body.get("score", 0)
    if prog.status == "completed":
        from datetime import datetime, timezone
        prog.solved_at = datetime.now(timezone.utc)
    await db.flush()
    return {"id": prog.id, "status": prog.status, "score": prog.score}


@router.get("/my-progress")
async def my_progress(
    user: User = Depends(require_permission("challenge.participate.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ChallengeProgress)
        .where(ChallengeProgress.user_id == user.id)
    )).scalars().all()
    return [{
        "problem_id": p.problem_id, "status": p.status, "score": p.score,
        "solved_at": p.solved_at.isoformat() if p.solved_at else None,
    } for p in rows]
