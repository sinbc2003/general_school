"""논문 라우터 — 논문, 키워드, 노트"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.papers import Paper, PaperStatus, CrawlKeyword, PaperNote, Newsletter
from app.models.user import User

router = APIRouter(prefix="/api/papers", tags=["papers"])


@router.get("")
async def list_papers(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = None, subject: str | None = None, search: str | None = None,
    user: User = Depends(require_permission("papers.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Paper).where(Paper.is_visible == True)
    cq = select(func.count(Paper.id)).where(Paper.is_visible == True)
    if status:
        q = q.where(Paper.status == status)
        cq = cq.where(Paper.status == status)
    if subject:
        q = q.where(Paper.subject == subject)
        cq = cq.where(Paper.subject == subject)
    if search:
        q = q.where(Paper.title.contains(search))
        cq = cq.where(Paper.title.contains(search))
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Paper.created_at)).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": p.id, "title": p.title, "arxiv_id": p.arxiv_id,
            "authors": p.authors, "status": p.status.value,
            "subject": p.subject, "relevance_score": p.relevance_score,
            "translated_title": p.translated_title,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        } for p in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{pid}")
async def get_paper(
    pid: int,
    user: User = Depends(require_permission("papers.view")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(Paper).where(Paper.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "논문을 찾을 수 없습니다")
    return {
        "id": p.id, "title": p.title, "arxiv_id": p.arxiv_id,
        "authors": p.authors, "abstract": p.abstract,
        "translated_title": p.translated_title, "translated_abstract": p.translated_abstract,
        "summary": p.summary, "tags": p.tags, "status": p.status.value,
        "subject": p.subject, "source": p.source,
        "published_date": p.published_date.isoformat() if p.published_date else None,
    }


@router.put("/{pid}/status")
async def update_paper_status(
    pid: int, body: dict,
    user: User = Depends(require_permission("papers.approve")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = (await db.execute(select(Paper).where(Paper.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "논문을 찾을 수 없습니다")
    p.status = PaperStatus(body["status"])
    await db.flush()
    await log_action(db, user, "paper.status", f"paper:{pid}", body["status"], request)
    return {"ok": True}


# ── Keywords ──

@router.get("/keywords/list")
async def list_keywords(
    user: User = Depends(require_permission("papers.keyword.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(CrawlKeyword).order_by(CrawlKeyword.id))).scalars().all()
    return [{"id": k.id, "keyword": k.keyword, "category": k.category, "is_active": k.is_active} for k in rows]


@router.post("/keywords")
async def create_keyword(
    body: dict,
    user: User = Depends(require_permission("papers.keyword.manage")),
    db: AsyncSession = Depends(get_db),
):
    k = CrawlKeyword(keyword=body["keyword"], category=body.get("category"))
    db.add(k)
    await db.flush()
    return {"id": k.id, "keyword": k.keyword}


@router.delete("/keywords/{kid}")
async def delete_keyword(
    kid: int,
    user: User = Depends(require_permission("papers.keyword.manage")),
    db: AsyncSession = Depends(get_db),
):
    k = (await db.execute(select(CrawlKeyword).where(CrawlKeyword.id == kid))).scalar_one_or_none()
    if not k:
        raise HTTPException(404, "키워드를 찾을 수 없습니다")
    await db.delete(k)
    return {"ok": True}


# ── Notes (학생) ──

@router.post("/{pid}/notes")
async def create_note(
    pid: int, body: dict,
    user: User = Depends(require_permission("papers.note.write")),
    db: AsyncSession = Depends(get_db),
):
    n = PaperNote(
        paper_id=pid, user_id=user.id,
        content=body["content"],
        page_number=body.get("page_number"),
        highlight_text=body.get("highlight_text"),
    )
    db.add(n)
    await db.flush()
    return {"id": n.id}


@router.get("/{pid}/notes")
async def list_notes(
    pid: int,
    user: User = Depends(require_permission("papers.note.write")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(PaperNote).where(PaperNote.paper_id == pid, PaperNote.user_id == user.id)
        .order_by(PaperNote.created_at)
    )).scalars().all()
    return [{"id": n.id, "content": n.content, "page_number": n.page_number,
             "highlight_text": n.highlight_text,
             "created_at": n.created_at.isoformat() if n.created_at else None} for n in rows]
