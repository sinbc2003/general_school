"""연구 라우터 — R&E 프로젝트, 일지, 산출물, 저널"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.research import ResearchProject, ResearchLog, ResearchSubmission, ResearchJournal
from app.models.user import User

router = APIRouter(prefix="/api/research", tags=["research"])
UPLOAD_DIR = os.path.join("storage", "research")


@router.post("")
async def create_project(
    body: dict,
    user: User = Depends(require_permission("research.project.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = ResearchProject(
        title=body["title"], research_type=body["research_type"],
        description=body.get("description"), advisor_id=body.get("advisor_id"),
        members=body.get("members"), year=body["year"],
        semester=body.get("semester"), created_by_id=user.id,
    )
    db.add(p)
    await db.flush()
    await log_action(db, user, "research.create", f"project:{p.id}", request=request)
    return {"id": p.id, "title": p.title}


@router.get("")
async def list_projects(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    year: int | None = None, semester: int | None = None, status: str | None = None,
    user: User = Depends(require_permission("research.project.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(ResearchProject)
    cq = select(func.count(ResearchProject.id))
    if year is not None:
        q = q.where(ResearchProject.year == year)
        cq = cq.where(ResearchProject.year == year)
    if semester is not None:
        q = q.where(ResearchProject.semester == semester)
        cq = cq.where(ResearchProject.semester == semester)
    if status:
        q = q.where(ResearchProject.status == status)
        cq = cq.where(ResearchProject.status == status)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(ResearchProject.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": p.id, "title": p.title, "research_type": p.research_type,
            "status": p.status, "year": p.year, "members": p.members,
        } for p in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{pid}")
async def get_project(
    pid: int,
    user: User = Depends(require_permission("research.project.view")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(ResearchProject).where(ResearchProject.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "연구를 찾을 수 없습니다")
    return {
        "id": p.id, "title": p.title, "research_type": p.research_type,
        "description": p.description, "status": p.status,
        "year": p.year, "semester": p.semester,
        "members": p.members, "milestones": p.milestones,
    }


@router.put("/{pid}")
async def update_project(
    pid: int, body: dict,
    user: User = Depends(require_permission("research.project.assign")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = (await db.execute(select(ResearchProject).where(ResearchProject.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    for f in ["title", "research_type", "description", "status", "members", "milestones"]:
        if f in body:
            setattr(p, f, body[f])
    await db.flush()
    await log_action(db, user, "research.update", f"project:{pid}", request=request)
    return {"ok": True}


# ── Logs ──

@router.post("/{pid}/logs")
async def create_log(
    pid: int, body: dict,
    user: User = Depends(require_permission("research.journal.write")),
    db: AsyncSession = Depends(get_db),
):
    log = ResearchLog(
        project_id=pid, author_id=user.id,
        title=body["title"], content=body["content"],
        log_type=body.get("log_type", "progress"),
    )
    db.add(log)
    await db.flush()
    return {"id": log.id}


@router.get("/{pid}/logs")
async def list_logs(
    pid: int,
    user: User = Depends(require_permission("research.journal.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ResearchLog).where(ResearchLog.project_id == pid)
        .order_by(desc(ResearchLog.created_at))
    )).scalars().all()
    return [{
        "id": l.id, "title": l.title, "content": l.content,
        "log_type": l.log_type, "feedback": l.feedback,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in rows]


# ── Journals (학생) ──

@router.post("/{pid}/journals")
async def create_journal(
    pid: int, body: dict,
    user: User = Depends(require_permission("research.journal.write")),
    db: AsyncSession = Depends(get_db),
):
    j = ResearchJournal(
        project_id=pid, author_id=user.id,
        content=body["content"], week_number=body["week_number"],
    )
    db.add(j)
    await db.flush()
    return {"id": j.id}


@router.get("/{pid}/journals")
async def list_journals(
    pid: int,
    user: User = Depends(require_permission("research.journal.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ResearchJournal).where(ResearchJournal.project_id == pid)
        .order_by(ResearchJournal.week_number)
    )).scalars().all()
    return [{
        "id": j.id, "author_id": j.author_id,
        "content": j.content, "week_number": j.week_number,
        "created_at": j.created_at.isoformat() if j.created_at else None,
    } for j in rows]


# ── Submissions ──

@router.post("/{pid}/submissions")
async def upload_submission(
    pid: int, file: UploadFile = File(...),
    title: str = "", submission_type: str = "report",
    user: User = Depends(require_permission("research.project.view")),
    db: AsyncSession = Depends(get_db),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    content = await file.read()
    with open(stored_path, "wb") as f:
        f.write(content)
    sub = ResearchSubmission(
        project_id=pid, title=title or file.filename or "Untitled",
        submission_type=submission_type, filename=file.filename or "unknown",
        stored_path=stored_path, file_size=len(content),
        submitted_by_id=user.id,
    )
    db.add(sub)
    await db.flush()
    return {"id": sub.id}


@router.get("/{pid}/submissions")
async def list_submissions(
    pid: int,
    user: User = Depends(require_permission("research.project.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ResearchSubmission).where(ResearchSubmission.project_id == pid)
        .order_by(desc(ResearchSubmission.created_at))
    )).scalars().all()
    return [{
        "id": s.id, "title": s.title, "submission_type": s.submission_type,
        "filename": s.filename, "file_size": s.file_size,
        "review_status": s.review_status,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s in rows]
