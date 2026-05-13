"""피드백 라우터 — 건의사항, 오류 신고"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.permissions import require_admin
from app.models.feedback import Feedback
from app.models.user import User

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("")
async def create_feedback(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    f = Feedback(
        user_id=user.id,
        feedback_type=body["feedback_type"],
        content=body["content"],
        page_url=body.get("page_url"),
    )
    db.add(f)
    await db.flush()
    return {"id": f.id}


@router.get("/mine")
async def my_feedback(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Feedback).where(Feedback.user_id == user.id)
        .order_by(desc(Feedback.created_at))
    )).scalars().all()
    return {"items": [{
        "id": f.id, "feedback_type": f.feedback_type,
        "content": f.content, "status": f.status,
        "admin_note": f.admin_note,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    } for f in rows]}


@router.get("")
async def list_feedback(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    q = select(Feedback)
    cq = select(func.count(Feedback.id))
    if status:
        q = q.where(Feedback.status == status)
        cq = cq.where(Feedback.status == status)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Feedback.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": f.id, "user_id": f.user_id,
            "feedback_type": f.feedback_type, "content": f.content,
            "page_url": f.page_url, "status": f.status,
            "admin_note": f.admin_note,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        } for f in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.patch("/{fid}")
async def update_feedback_status(
    fid: int, body: dict,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    f = (await db.execute(select(Feedback).where(Feedback.id == fid))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "피드백을 찾을 수 없습니다")
    if "status" in body:
        f.status = body["status"]
    if "admin_note" in body:
        f.admin_note = body["admin_note"]
    await db.flush()
    return {"ok": True}
