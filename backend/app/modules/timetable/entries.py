"""시간표 항목 + 교사 본인 개인 일정 (회의/면담/행사) endpoints.

entry_type:
- 'class': 수업 — 관리자만 CRUD (timetable.edit 권한)
- 'meeting' / 'consultation' / 'event' / 'other': 본인이 자기 시간표에 추가

router 객체는 router.py에서 공유. router.py 끝의 'from . import entries'로 등록.
"""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.timetable import TimetableEntry
from app.models.user import User

from app.modules.timetable.router import router, _assert_semester_writable


# ── Entries (시간표 항목 — 관리자/교사 CRUD) ──

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
        "entry_type": getattr(e, "entry_type", "class"),
        "note": getattr(e, "note", None),
    } for e in rows]


@router.put("/entries/{eid}")
async def update_entry(
    eid: int, body: dict, request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """단일 시간표 항목 수정.

    - super_admin / designated_admin: 모든 entry 수정 가능
    - teacher: 본인 entry(teacher_id==user.id) 만 수정 가능
    - 보관된 학기는 수정 차단.
    """
    e = (await db.execute(select(TimetableEntry).where(TimetableEntry.id == eid))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "시간표 항목을 찾을 수 없습니다")
    await _assert_semester_writable(db, e.semester_id)

    is_admin = user.role in ("super_admin", "designated_admin")
    is_owner = e.teacher_id == user.id
    if not (is_admin or is_owner):
        raise HTTPException(403, "본인 시간표만 수정 가능합니다")

    for f in ("subject", "class_name", "room", "note"):
        if f in body:
            setattr(e, f, body[f])
    # 시간 슬롯(day_of_week/period) 변경은 admin만
    if is_admin:
        if "day_of_week" in body:
            e.day_of_week = int(body["day_of_week"])
        if "period" in body:
            e.period = int(body["period"])
        if "teacher_id" in body:
            e.teacher_id = int(body["teacher_id"])
        if "entry_type" in body:
            e.entry_type = body["entry_type"]
    await db.flush()
    await log_action(db, user, "timetable.update", f"id:{eid}", request=request)
    return {"id": e.id}


@router.post("/entries")
async def create_entry(
    body: dict,
    user: User = Depends(require_permission("timetable.edit")),
    db: AsyncSession = Depends(get_db),
):
    await _assert_semester_writable(db, body["semester_id"])
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


# ── 교사 본인 개인 일정 (회의/면담/행사) ──
# entry_type ∈ {meeting, consultation, event, other} 만 본인이 CRUD.
# 'class'(수업)은 관리자만 위 endpoint 사용.
# class_name unique constraint 회피용: f"@personal-{user.id}-{day}-{period}".

_PERSONAL_TYPES = {"meeting", "consultation", "event", "other"}


@router.get("/my-events")
async def list_my_events(
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인이 등록한 개인 일정 + 본인 수업 (시각화용). entry_type별 색 표시 가능."""
    sid = semester_id
    if not sid:
        from app.core.semester import get_current_semester
        sem = await get_current_semester(db)
        if not sem:
            return {"items": []}
        sid = sem.id
    rows = (await db.execute(
        select(TimetableEntry).where(
            TimetableEntry.semester_id == sid,
            TimetableEntry.teacher_id == user.id,
        ).order_by(TimetableEntry.day_of_week, TimetableEntry.period)
    )).scalars().all()
    return {"items": [{
        "id": e.id, "day_of_week": e.day_of_week, "period": e.period,
        "subject": e.subject, "class_name": e.class_name, "room": e.room,
        "entry_type": getattr(e, "entry_type", "class"),
        "note": getattr(e, "note", None),
    } for e in rows]}


@router.post("/my-events")
async def create_my_event(
    body: dict, request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인 개인 일정 추가 (회의/면담/행사). entry_type=class는 차단."""
    entry_type = (body.get("entry_type") or "meeting").strip().lower()
    if entry_type not in _PERSONAL_TYPES:
        raise HTTPException(400, f"entry_type은 {_PERSONAL_TYPES} 중 하나여야 합니다")
    sid = body.get("semester_id")
    if not sid:
        from app.core.semester import get_current_semester
        sem = await get_current_semester(db)
        if not sem:
            raise HTTPException(400, "현재 학기가 설정되지 않았습니다")
        sid = sem.id

    day = int(body.get("day_of_week", 0))
    period = int(body.get("period", 1))
    subject = (body.get("subject") or "").strip() or "(개인 일정)"
    # unique constraint 회피용 — 본인 + 슬롯이 다르면 안전
    class_name = f"@personal-{user.id}-{day}-{period}-{entry_type}"

    e = TimetableEntry(
        semester_id=sid, teacher_id=user.id,
        day_of_week=day, period=period,
        subject=subject[:100],
        class_name=class_name[:50],
        room=(body.get("room") or None),
        entry_type=entry_type,
        note=(body.get("note") or None),
    )
    db.add(e)
    await db.flush()
    await log_action(db, user, "timetable.my_event.create", f"id:{e.id} type:{entry_type}", request=request)
    return {"id": e.id, "entry_type": entry_type}


@router.put("/my-events/{eid}")
async def update_my_event(
    eid: int, body: dict, request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(
        select(TimetableEntry).where(
            TimetableEntry.id == eid,
            TimetableEntry.teacher_id == user.id,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "본인의 일정만 수정 가능합니다")
    if e.entry_type == "class":
        raise HTTPException(403, "수업 항목은 관리자만 수정 가능합니다")
    for f in ("subject", "room", "note"):
        if f in body:
            setattr(e, f, body[f])
    if "entry_type" in body:
        new_type = (body["entry_type"] or "").strip().lower()
        if new_type in _PERSONAL_TYPES:
            e.entry_type = new_type
    await db.flush()
    await log_action(db, user, "timetable.my_event.update", f"id:{eid}", request=request)
    return {"id": e.id}


@router.delete("/my-events/{eid}")
async def delete_my_event(
    eid: int, request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    e = (await db.execute(
        select(TimetableEntry).where(
            TimetableEntry.id == eid,
            TimetableEntry.teacher_id == user.id,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "본인의 일정만 삭제 가능합니다")
    if e.entry_type == "class":
        raise HTTPException(403, "수업 항목은 관리자만 삭제 가능합니다")
    await db.delete(e)
    await db.flush()
    await log_action(db, user, "timetable.my_event.delete", f"id:{eid}", request=request)
    return {"ok": True}
