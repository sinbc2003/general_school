"""커뮤니티 라우터 — 학생 출제 문제, 풀이, 투표"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.community import CommunityProblem, CommunitySolution, CommunityVote
from app.models.user import User

router = APIRouter(prefix="/api/community", tags=["community"])


@router.post("/problems")
async def create_problem(
    body: dict,
    user: User = Depends(require_permission("community.problem.create")),
    db: AsyncSession = Depends(get_db),
):
    p = CommunityProblem(
        author_id=user.id, title=body["title"],
        content=body["content"], solution=body["solution"],
        answer=body.get("answer"), subject=body["subject"],
        difficulty=body["difficulty"], question_type=body["question_type"],
    )
    db.add(p)
    await db.flush()
    return {"id": p.id}


@router.get("/problems")
async def list_problems(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    subject: str | None = None, status: str | None = None,
    user: User = Depends(require_permission("community.problem.create")),
    db: AsyncSession = Depends(get_db),
):
    q = select(CommunityProblem)
    cq = select(func.count(CommunityProblem.id))
    if subject:
        q = q.where(CommunityProblem.subject == subject)
        cq = cq.where(CommunityProblem.subject == subject)
    if status:
        q = q.where(CommunityProblem.status == status)
        cq = cq.where(CommunityProblem.status == status)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(CommunityProblem.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": p.id, "title": p.title, "subject": p.subject,
            "difficulty": p.difficulty, "status": p.status,
            "solve_count": p.solve_count, "vote_count": p.vote_count,
            "avg_rating": p.avg_rating,
        } for p in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/problems/{pid}")
async def get_problem(
    pid: int,
    user: User = Depends(require_permission("community.problem.create")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(CommunityProblem).where(CommunityProblem.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    return {
        "id": p.id, "title": p.title, "content": p.content,
        "solution": p.solution, "answer": p.answer,
        "subject": p.subject, "difficulty": p.difficulty,
        "question_type": p.question_type, "status": p.status,
        "solve_count": p.solve_count, "avg_rating": p.avg_rating,
    }


# ── Solutions ──

@router.post("/problems/{pid}/solutions")
async def submit_solution(
    pid: int, body: dict,
    user: User = Depends(require_permission("community.solution.submit")),
    db: AsyncSession = Depends(get_db),
):
    s = CommunitySolution(
        problem_id=pid, author_id=user.id, content=body["content"],
    )
    db.add(s)
    # increment solve count
    p = (await db.execute(select(CommunityProblem).where(CommunityProblem.id == pid))).scalar_one_or_none()
    if p:
        p.solve_count += 1
    await db.flush()
    return {"id": s.id}


@router.get("/problems/{pid}/solutions")
async def list_solutions(
    pid: int,
    user: User = Depends(require_permission("community.solution.submit")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(CommunitySolution, User.name)
        .join(User, User.id == CommunitySolution.author_id)
        .where(CommunitySolution.problem_id == pid)
        .order_by(desc(CommunitySolution.created_at))
    )).all()
    return [{
        "id": s[0].id, "author_id": s[0].author_id, "name": s[1],
        "content": s[0].content, "is_correct": s[0].is_correct,
        "score": s[0].score,
    } for s in rows]


# ── Votes ──

@router.post("/problems/{pid}/vote")
async def vote_problem(
    pid: int, body: dict,
    user: User = Depends(require_permission("community.problem.create")),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(CommunityVote)
        .where(CommunityVote.user_id == user.id, CommunityVote.problem_id == pid)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "이미 투표했습니다")
    v = CommunityVote(
        user_id=user.id, problem_id=pid,
        rating=body["rating"],
        accuracy_vote=body.get("accuracy_vote", True),
        difficulty_appropriate=body.get("difficulty_appropriate", True),
    )
    db.add(v)
    # update problem stats
    p = (await db.execute(select(CommunityProblem).where(CommunityProblem.id == pid))).scalar_one_or_none()
    if p:
        p.vote_count += 1
        total_rating = (await db.execute(
            select(func.avg(CommunityVote.rating)).where(CommunityVote.problem_id == pid)
        )).scalar() or 0
        p.avg_rating = round(float(total_rating), 2)
    await db.flush()
    return {"ok": True}
