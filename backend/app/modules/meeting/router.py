"""회의 라우터 — 협의록 CRUD, 교과별 필터링, 첨부파일"""

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func, select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.meeting import Meeting, MeetingStatus, MeetingAttachment
from app.models.user import User

router = APIRouter(prefix="/api/meeting", tags=["meeting"])
UPLOAD_DIR = os.path.join("storage", "meetings")


def _dept_filter(user: User):
    """교과 필터: 관리자는 전체, 교사/직원은 동교과 + 전체(department=None)만"""
    if user.role in ("super_admin", "designated_admin"):
        return None  # 필터 없음
    # 동교과 or 전체(department가 NULL)
    if user.department:
        return or_(
            Meeting.department == user.department,
            Meeting.department.is_(None),
        )
    return Meeting.department.is_(None)


@router.get("/departments")
async def list_departments(
    user: User = Depends(require_permission("meeting.view")),
    db: AsyncSession = Depends(get_db),
):
    """협의록에 사용된 교과 목록"""
    rows = (await db.execute(
        select(Meeting.department).where(Meeting.department.isnot(None)).distinct()
    )).scalars().all()
    return sorted(set(rows))


@router.post("")
async def create_meeting(
    body: dict,
    user: User = Depends(require_permission("meeting.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    # department: 명시하지 않으면 작성자의 교과 사용
    dept = body.get("department")
    if dept is None and user.department:
        dept = user.department

    m = Meeting(
        title=body["title"], date=body["date"],
        department=dept,
        location=body.get("location"), attendees=body.get("attendees"),
        agenda=body.get("agenda"), created_by_id=user.id,
    )
    db.add(m)
    await db.flush()
    await log_action(db, user, "meeting.create", f"meeting:{m.id}", request=request)
    return {"id": m.id, "title": m.title}


@router.get("")
async def list_meetings(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    department: str | None = None,
    user: User = Depends(require_permission("meeting.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Meeting)
    cq = select(func.count(Meeting.id))

    # 교과 필터 (권한 기반)
    dept_cond = _dept_filter(user)
    if dept_cond is not None:
        q = q.where(dept_cond)
        cq = cq.where(dept_cond)

    # 추가 교과 필터 (관리자가 특정 교과만 보려 할 때)
    if department:
        if department == "__all__":
            q = q.where(Meeting.department.is_(None))
            cq = cq.where(Meeting.department.is_(None))
        else:
            q = q.where(Meeting.department == department)
            cq = cq.where(Meeting.department == department)

    if status:
        q = q.where(Meeting.status == status)
        cq = cq.where(Meeting.status == status)

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Meeting.date)).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": m.id, "title": m.title, "date": m.date.isoformat() if m.date else None,
            "department": m.department,
            "location": m.location, "status": m.status.value,
            "attendees": m.attendees,
        } for m in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{mid}")
async def get_meeting(
    mid: int,
    user: User = Depends(require_permission("meeting.view")),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(Meeting).where(Meeting.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "회의를 찾을 수 없습니다")

    # 교과 접근 권한 체크
    if user.role not in ("super_admin", "designated_admin"):
        if m.department and m.department != user.department:
            raise HTTPException(403, "해당 교과의 협의록에 접근할 수 없습니다")

    return {
        "id": m.id, "title": m.title, "date": m.date.isoformat() if m.date else None,
        "department": m.department,
        "location": m.location, "attendees": m.attendees,
        "agenda": m.agenda, "minutes": m.minutes, "decisions": m.decisions,
        "status": m.status.value,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.put("/{mid}")
async def update_meeting(
    mid: int, body: dict,
    user: User = Depends(require_permission("meeting.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    m = (await db.execute(select(Meeting).where(Meeting.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "회의를 찾을 수 없습니다")
    for f in ["title", "date", "location", "attendees", "agenda", "minutes", "decisions", "department"]:
        if f in body:
            setattr(m, f, body[f])
    if "status" in body:
        m.status = MeetingStatus(body["status"])
    await db.flush()
    await log_action(db, user, "meeting.update", f"meeting:{mid}", request=request)
    return {"ok": True}


@router.delete("/{mid}")
async def delete_meeting(
    mid: int,
    user: User = Depends(require_permission("meeting.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    m = (await db.execute(select(Meeting).where(Meeting.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "회의를 찾을 수 없습니다")
    await db.delete(m)
    await log_action(db, user, "meeting.delete", f"meeting:{mid}", request=request)
    return {"ok": True}


# ── Attachments ──

@router.post("/{mid}/attachments")
async def upload_attachment(
    mid: int, file: UploadFile = File(...),
    user: User = Depends(require_permission("meeting.edit")),
    db: AsyncSession = Depends(get_db),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    content = await file.read()
    with open(stored_path, "wb") as f:
        f.write(content)
    att = MeetingAttachment(
        meeting_id=mid, filename=file.filename or "unknown",
        stored_path=stored_path, file_size=len(content), uploaded_by_id=user.id,
    )
    db.add(att)
    await db.flush()
    return {"id": att.id, "filename": att.filename}


@router.get("/{mid}/attachments/{aid}/download")
async def download_attachment(
    mid: int, aid: int,
    user: User = Depends(require_permission("meeting.view")),
    db: AsyncSession = Depends(get_db),
):
    att = (await db.execute(
        select(MeetingAttachment)
        .where(MeetingAttachment.id == aid, MeetingAttachment.meeting_id == mid)
    )).scalar_one_or_none()
    if not att or not os.path.exists(att.stored_path):
        raise HTTPException(404, "첨부파일을 찾을 수 없습니다")
    return FileResponse(att.stored_path, filename=att.filename)
