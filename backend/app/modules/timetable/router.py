"""시간표 라우터 — 학기, 시간표 항목"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.timetable import Semester, TimetableEntry
from app.models.user import User

router = APIRouter(prefix="/api/timetable", tags=["timetable"])


# ── Semesters ──

@router.get("/semesters")
async def list_semesters(
    user: User = Depends(require_permission("timetable.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(Semester).order_by(Semester.year.desc(), Semester.semester.desc()))).scalars().all()
    return [{
        "id": s.id, "year": s.year, "semester": s.semester,
        "name": s.name, "start_date": s.start_date.isoformat(),
        "end_date": s.end_date.isoformat(), "is_current": s.is_current,
    } for s in rows]


@router.post("/semesters")
async def create_semester(
    body: dict,
    user: User = Depends(require_permission("timetable.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    s = Semester(
        year=body["year"], semester=body["semester"],
        name=body["name"], start_date=body["start_date"],
        end_date=body["end_date"], is_current=body.get("is_current", False),
    )
    db.add(s)
    await db.flush()
    await log_action(db, user, "semester.create", f"semester:{s.id}", request=request)
    return {"id": s.id}


# ── Entries ──

@router.get("/entries")
async def list_entries(
    semester_id: int | None = None,
    teacher_id: int | None = None,
    user: User = Depends(require_permission("timetable.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(TimetableEntry)
    if semester_id:
        q = q.where(TimetableEntry.semester_id == semester_id)
    if teacher_id:
        q = q.where(TimetableEntry.teacher_id == teacher_id)
    rows = (await db.execute(
        q.order_by(TimetableEntry.day_of_week, TimetableEntry.period)
    )).scalars().all()
    return [{
        "id": e.id, "semester_id": e.semester_id, "teacher_id": e.teacher_id,
        "day_of_week": e.day_of_week, "period": e.period,
        "subject": e.subject, "class_name": e.class_name, "room": e.room,
    } for e in rows]


@router.post("/entries")
async def create_entry(
    body: dict,
    user: User = Depends(require_permission("timetable.edit")),
    db: AsyncSession = Depends(get_db),
):
    e = TimetableEntry(
        semester_id=body["semester_id"], teacher_id=body["teacher_id"],
        day_of_week=body["day_of_week"], period=body["period"],
        subject=body["subject"], class_name=body["class_name"],
        room=body.get("room"),
    )
    db.add(e)
    await db.flush()
    return {"id": e.id}


@router.post("/entries/bulk")
async def bulk_create_entries(
    body: dict,
    user: User = Depends(require_permission("timetable.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    entries = body.get("entries", [])
    created = 0
    for item in entries:
        e = TimetableEntry(
            semester_id=item["semester_id"], teacher_id=item["teacher_id"],
            day_of_week=item["day_of_week"], period=item["period"],
            subject=item["subject"], class_name=item["class_name"],
            room=item.get("room"),
        )
        db.add(e)
        created += 1
    await db.flush()
    await log_action(db, user, "timetable.bulk_create", f"count:{created}", request=request)
    return {"created": created}


@router.delete("/entries/{eid}")
async def delete_entry(
    eid: int,
    user: User = Depends(require_permission("timetable.edit")),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(select(TimetableEntry).where(TimetableEntry.id == eid))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "시간표 항목을 찾을 수 없습니다")
    await db.delete(e)
    return {"ok": True}
