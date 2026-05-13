"""과제 라우터 — 과제 CRUD, 제출, 검토"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.assignment import Assignment, AssignmentStatus, AssignmentSubmission, SubmissionStatus
from app.models.user import User

router = APIRouter(prefix="/api/assignment", tags=["assignment"])
UPLOAD_DIR = os.path.join("storage", "assignments")


@router.post("")
async def create_assignment(
    body: dict,
    user: User = Depends(require_permission("assignment.manage.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    a = Assignment(
        title=body["title"],
        subject=body["subject"],
        description=body.get("description"),
        target_grades=body.get("target_grades"),
        due_date=body["due_date"],
        submission_format=body.get("submission_format", "pdf"),
        created_by_id=user.id,
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "assignment.create", f"assignment:{a.id}", request=request)
    return {"id": a.id, "title": a.title}


@router.get("")
async def list_assignments(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    subject: str | None = None,
    user: User = Depends(require_permission("assignment.submit.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Assignment)
    cq = select(func.count(Assignment.id))
    if user.role == "student":
        q = q.where(Assignment.is_visible == True, Assignment.status != AssignmentStatus.DRAFT)
        cq = cq.where(Assignment.is_visible == True, Assignment.status != AssignmentStatus.DRAFT)
    if status:
        q = q.where(Assignment.status == status)
        cq = cq.where(Assignment.status == status)
    if subject:
        q = q.where(Assignment.subject == subject)
        cq = cq.where(Assignment.subject == subject)

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Assignment.due_date))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    sub_counts = {}
    if rows:
        ids = [a.id for a in rows]
        sub_counts = dict((await db.execute(
            select(AssignmentSubmission.assignment_id, func.count(AssignmentSubmission.id))
            .where(AssignmentSubmission.assignment_id.in_(ids))
            .group_by(AssignmentSubmission.assignment_id)
        )).all())

    return {
        "items": [
            {
                "id": a.id, "title": a.title, "subject": a.subject,
                "status": a.status.value, "due_date": a.due_date.isoformat() if a.due_date else None,
                "submission_count": sub_counts.get(a.id, 0),
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in rows
        ],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{aid}")
async def get_assignment(
    aid: int,
    user: User = Depends(require_permission("assignment.submit.view")),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(Assignment).where(Assignment.id == aid))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다")
    return {
        "id": a.id, "title": a.title, "subject": a.subject,
        "description": a.description, "target_grades": a.target_grades,
        "due_date": a.due_date.isoformat() if a.due_date else None,
        "submission_format": a.submission_format, "status": a.status.value,
        "is_visible": a.is_visible,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@router.put("/{aid}")
async def update_assignment(
    aid: int, body: dict,
    user: User = Depends(require_permission("assignment.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    a = (await db.execute(select(Assignment).where(Assignment.id == aid))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다")
    for f in ["title", "subject", "description", "target_grades", "due_date",
              "submission_format", "is_visible"]:
        if f in body:
            setattr(a, f, body[f])
    if "status" in body:
        a.status = AssignmentStatus(body["status"])
    await db.flush()
    await log_action(db, user, "assignment.update", f"assignment:{aid}", request=request)
    return {"ok": True}


@router.delete("/{aid}")
async def delete_assignment(
    aid: int,
    user: User = Depends(require_permission("assignment.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    a = (await db.execute(select(Assignment).where(Assignment.id == aid))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다")
    await db.delete(a)
    await log_action(db, user, "assignment.delete", f"assignment:{aid}", request=request)
    return {"ok": True}


# ── Submissions ──

@router.post("/{aid}/submit")
async def submit_assignment(
    aid: int,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("assignment.submit.upload")),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(Assignment).where(Assignment.id == aid))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "과제를 찾을 수 없습니다")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)
    content = await file.read()
    with open(stored_path, "wb") as f:
        f.write(content)

    sub = AssignmentSubmission(
        assignment_id=aid,
        user_id=user.id,
        filename=file.filename,
        stored_path=stored_path,
        file_size=len(content),
    )
    db.add(sub)
    await db.flush()
    return {"id": sub.id, "status": sub.status.value}


@router.get("/{aid}/submissions")
async def list_submissions(
    aid: int,
    user: User = Depends(require_permission("assignment.manage.review")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(AssignmentSubmission, User.name, User.email)
        .join(User, User.id == AssignmentSubmission.user_id)
        .where(AssignmentSubmission.assignment_id == aid)
        .order_by(desc(AssignmentSubmission.submitted_at))
    )).all()
    return [
        {
            "id": s[0].id, "user_id": s[0].user_id,
            "name": s[1], "email": s[2],
            "filename": s[0].filename, "status": s[0].status.value,
            "submitted_at": s[0].submitted_at.isoformat() if s[0].submitted_at else None,
            "review_comment": s[0].review_comment,
        }
        for s in rows
    ]


@router.put("/{aid}/submissions/{sid}/review")
async def review_submission(
    aid: int, sid: int, body: dict,
    user: User = Depends(require_permission("assignment.manage.review")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sub = (await db.execute(
        select(AssignmentSubmission)
        .where(AssignmentSubmission.id == sid, AssignmentSubmission.assignment_id == aid)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "제출물을 찾을 수 없습니다")
    sub.status = SubmissionStatus(body.get("status", "reviewed"))
    sub.review_comment = body.get("review_comment")
    sub.reviewed_by_id = user.id
    await db.flush()
    await log_action(db, user, "submission.review", f"submission:{sid}", request=request)
    return {"ok": True}
