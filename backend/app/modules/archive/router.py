"""아카이브 라우터 — 문서/문제 CRUD"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.archive import Document, DocumentStatus, Problem, Tag, PublishedProblemSet
from app.models.user import User

router = APIRouter(prefix="/api/archive", tags=["archive"])
UPLOAD_DIR = os.path.join("storage", "documents")


# ── Documents ──

@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    title: str = "",
    doc_type: str = "exam",
    subject: str = "math",
    grade: int | None = None,
    year: int | None = None,
    semester: int | None = None,
    user: User = Depends(require_permission("archive.document.upload")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)

    content = await file.read()
    with open(stored_path, "wb") as f:
        f.write(content)

    doc = Document(
        title=title or file.filename or "Untitled",
        doc_type=doc_type,
        subject=subject,
        grade=grade,
        year=year,
        semester=semester,
        original_filename=file.filename or "unknown",
        stored_path=stored_path,
        file_size=len(content),
        status=DocumentStatus.COMPLETED,
        uploaded_by_id=user.id,
    )
    db.add(doc)
    await db.flush()
    await log_action(db, user, "document.upload", f"document:{doc.id}", request=request)
    return {"id": doc.id, "title": doc.title, "status": doc.status.value}


@router.get("/documents")
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    doc_type: str | None = None,
    subject: str | None = None,
    user: User = Depends(require_permission("archive.document.upload")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Document)
    cq = select(func.count(Document.id))
    if doc_type:
        q = q.where(Document.doc_type == doc_type)
        cq = cq.where(Document.doc_type == doc_type)
    if subject:
        q = q.where(Document.subject == subject)
        cq = cq.where(Document.subject == subject)

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Document.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [
            {
                "id": d.id, "title": d.title, "doc_type": d.doc_type,
                "subject": d.subject, "grade": d.grade, "year": d.year,
                "file_size": d.file_size, "status": d.status.value,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in rows
        ],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: int,
    user: User = Depends(require_permission("archive.document.upload")),
    db: AsyncSession = Depends(get_db),
):
    doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다")
    return {
        "id": doc.id, "title": doc.title, "doc_type": doc.doc_type,
        "subject": doc.subject, "grade": doc.grade, "year": doc.year,
        "semester": doc.semester, "original_filename": doc.original_filename,
        "file_size": doc.file_size, "page_count": doc.page_count,
        "status": doc.status.value, "tags": doc.tags,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


@router.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: int,
    user: User = Depends(require_permission("archive.document.delete")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다")
    if os.path.exists(doc.stored_path):
        os.remove(doc.stored_path)
    await db.delete(doc)
    await log_action(db, user, "document.delete", f"document:{doc_id}", request=request)
    return {"ok": True}


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: int,
    user: User = Depends(require_permission("archive.document.upload")),
    db: AsyncSession = Depends(get_db),
):
    doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "문서를 찾을 수 없습니다")
    if not os.path.exists(doc.stored_path):
        raise HTTPException(404, "파일이 존재하지 않습니다")
    return FileResponse(doc.stored_path, filename=doc.original_filename)


# ── Problems ──

@router.get("/problems")
async def list_problems(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    subject: str | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    search: str | None = None,
    user: User = Depends(require_permission("problem.library.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Problem).where(Problem.is_visible == True)
    cq = select(func.count(Problem.id)).where(Problem.is_visible == True)
    if subject:
        q = q.where(Problem.subject == subject)
        cq = cq.where(Problem.subject == subject)
    if difficulty:
        q = q.where(Problem.difficulty == difficulty)
        cq = cq.where(Problem.difficulty == difficulty)
    if question_type:
        q = q.where(Problem.question_type == question_type)
        cq = cq.where(Problem.question_type == question_type)
    if search:
        q = q.where(Problem.content.contains(search))
        cq = cq.where(Problem.content.contains(search))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Problem.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [
            {
                "id": p.id, "subject": p.subject, "difficulty": p.difficulty,
                "question_type": p.question_type, "year": p.year,
                "content": p.content[:200], "tags": p.tags,
                "review_status": p.review_status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in rows
        ],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/problems/{pid}")
async def get_problem(
    pid: int,
    user: User = Depends(require_permission("problem.library.view")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(Problem).where(Problem.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    return {
        "id": p.id, "subject": p.subject, "difficulty": p.difficulty,
        "question_type": p.question_type, "grade_semester": p.grade_semester,
        "year": p.year, "content": p.content, "solution": p.solution,
        "answer": p.answer, "tags": p.tags, "extra": p.extra,
        "review_status": p.review_status, "is_visible": p.is_visible,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.post("/problems")
async def create_problem(
    body: dict,
    user: User = Depends(require_permission("problem.library.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = Problem(
        department=body.get("department", "math"),
        subject=body["subject"],
        difficulty=body["difficulty"],
        question_type=body["question_type"],
        content=body["content"],
        solution=body.get("solution"),
        answer=body.get("answer"),
        grade_semester=body.get("grade_semester"),
        year=body.get("year"),
        tags=body.get("tags"),
        extra=body.get("extra"),
        created_by_id=user.id,
    )
    db.add(p)
    await db.flush()
    await log_action(db, user, "problem.create", f"problem:{p.id}", request=request)
    return {"id": p.id}


@router.put("/problems/{pid}")
async def update_problem(
    pid: int,
    body: dict,
    user: User = Depends(require_permission("problem.library.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = (await db.execute(select(Problem).where(Problem.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    for field in ["subject", "difficulty", "question_type", "content", "solution",
                   "answer", "grade_semester", "year", "tags", "extra", "review_status", "is_visible"]:
        if field in body:
            setattr(p, field, body[field])
    await db.flush()
    await log_action(db, user, "problem.update", f"problem:{pid}", request=request)
    return {"ok": True}


@router.delete("/problems/{pid}")
async def delete_problem(
    pid: int,
    user: User = Depends(require_permission("problem.library.delete")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    p = (await db.execute(select(Problem).where(Problem.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "문제를 찾을 수 없습니다")
    await db.delete(p)
    await log_action(db, user, "problem.delete", f"problem:{pid}", request=request)
    return {"ok": True}
