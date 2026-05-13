"""시간표 라우터 — 학기, 학기 명단(enrollment), 시간표 항목"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_current_semester, get_semester_by_id_or_404
from app.models.timetable import Semester, TimetableEntry, SemesterEnrollment
from app.models.user import User
from app.services.semester_import import (
    import_enrollments_csv,
    template_csv as semester_template_csv,
)

router = APIRouter(prefix="/api/timetable", tags=["timetable"])


def _semester_to_dict(s: Semester) -> dict:
    return {
        "id": s.id, "year": s.year, "semester": s.semester,
        "name": s.name,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "end_date": s.end_date.isoformat() if s.end_date else None,
        "is_current": s.is_current,
    }


def _parse_date(v: str | date | None) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v))


# ── Semesters ──

@router.get("/semesters")
async def list_semesters(
    user: User = Depends(require_permission("timetable.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(Semester).order_by(Semester.year.desc(), Semester.semester.desc()))).scalars().all()
    return [_semester_to_dict(s) for s in rows]


@router.get("/semesters/current")
async def get_current_semester_endpoint(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 학기(is_current=True) 1개 반환. 없으면 null.

    모든 인증된 사용자가 사이드바 등에서 현재 학기를 알아야 하므로 권한 체크 없음.
    """
    s = await get_current_semester(db)
    return _semester_to_dict(s) if s else None


@router.post("/semesters")
async def create_semester(
    body: dict,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    year = int(body["year"])
    semester = int(body["semester"])
    # 중복 체크
    exists = (await db.execute(
        select(Semester).where(Semester.year == year, Semester.semester == semester)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, f"이미 {year}년 {semester}학기가 존재합니다")

    is_current = bool(body.get("is_current", False))
    if is_current:
        # 기존 current 해제
        await db.execute(sql_update(Semester).values(is_current=False))

    s = Semester(
        year=year, semester=semester,
        name=body.get("name") or f"{year}학년도 {semester}학기",
        start_date=_parse_date(body["start_date"]),
        end_date=_parse_date(body["end_date"]),
        is_current=is_current,
    )
    db.add(s)
    await db.flush()
    await log_action(db, user, "semester.create", f"semester:{s.id}", request=request)
    return _semester_to_dict(s)


@router.put("/semesters/{sid}")
async def update_semester(
    sid: int, body: dict,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    s = await get_semester_by_id_or_404(db, sid)
    if "name" in body:
        s.name = body["name"]
    if "start_date" in body:
        s.start_date = _parse_date(body["start_date"])
    if "end_date" in body:
        s.end_date = _parse_date(body["end_date"])
    if "year" in body:
        s.year = int(body["year"])
    if "semester" in body:
        s.semester = int(body["semester"])
    await db.flush()
    await log_action(db, user, "semester.update", f"semester:{sid}", request=request)
    return _semester_to_dict(s)


@router.post("/semesters/{sid}/set-current")
async def set_current_semester(
    sid: int,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """이 학기를 현재 학기로 지정 (다른 모든 학기는 is_current=False)."""
    s = await get_semester_by_id_or_404(db, sid)
    await db.execute(sql_update(Semester).values(is_current=False))
    s.is_current = True
    await db.flush()
    await log_action(db, user, "semester.set_current", f"semester:{sid}", request=request)
    return _semester_to_dict(s)


@router.delete("/semesters/{sid}")
async def delete_semester(
    sid: int,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    s = await get_semester_by_id_or_404(db, sid)
    if s.is_current:
        raise HTTPException(400, "현재 학기는 삭제할 수 없습니다. 다른 학기를 현재로 지정한 후 삭제하세요.")
    await db.delete(s)
    await log_action(db, user, "semester.delete", f"semester:{sid}", request=request)
    return {"ok": True}


# ── Semester Enrollments (학기별 명단) ──

def _enrollment_to_dict(e: SemesterEnrollment, u: User | None = None) -> dict:
    return {
        "id": e.id,
        "semester_id": e.semester_id,
        "user_id": e.user_id,
        "role": e.role,
        "status": e.status,
        "grade": e.grade,
        "class_number": e.class_number,
        "student_number": e.student_number,
        "department": e.department,
        "position": e.position,
        "homeroom_class": e.homeroom_class,
        "phone": e.phone,
        "note": e.note,
        "user": {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "name": u.name,
            "phone": u.phone,
        } if u else None,
    }


@router.get("/semesters/{sid}/enrollments")
async def list_enrollments(
    sid: int,
    role: str | None = None,
    status: str | None = None,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학기별 명단 조회."""
    await get_semester_by_id_or_404(db, sid)
    q = (
        select(SemesterEnrollment, User)
        .join(User, User.id == SemesterEnrollment.user_id)
        .where(SemesterEnrollment.semester_id == sid)
    )
    if role:
        q = q.where(SemesterEnrollment.role == role)
    if status:
        q = q.where(SemesterEnrollment.status == status)
    q = q.order_by(
        SemesterEnrollment.role,
        SemesterEnrollment.grade.asc().nulls_last(),
        SemesterEnrollment.class_number.asc().nulls_last(),
        SemesterEnrollment.student_number.asc().nulls_last(),
        User.name,
    )
    rows = (await db.execute(q)).all()
    return [_enrollment_to_dict(e, u) for (e, u) in rows]


@router.post("/semesters/{sid}/enrollments")
async def add_enrollment(
    sid: int, body: dict,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await get_semester_by_id_or_404(db, sid)
    uid = int(body["user_id"])
    target = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "대상 사용자를 찾을 수 없습니다")
    # 중복 체크
    dup = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == uid,
        )
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(400, "이미 해당 학기에 등록된 사용자입니다")

    e = SemesterEnrollment(
        semester_id=sid,
        user_id=uid,
        role=body.get("role") or target.role,
        status=body.get("status", "active"),
        grade=body.get("grade"),
        class_number=body.get("class_number"),
        student_number=body.get("student_number"),
        department=body.get("department"),
        position=body.get("position"),
        homeroom_class=body.get("homeroom_class"),
        note=body.get("note"),
    )
    db.add(e)
    await db.flush()
    await log_action(db, user, "enrollment.add", f"sem:{sid}/user:{uid}", request=request)
    return _enrollment_to_dict(e, target)


@router.put("/semesters/{sid}/enrollments/{eid}")
async def update_enrollment(
    sid: int, eid: int, body: dict,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "명단 항목을 찾을 수 없습니다")
    for f in ["role", "status", "grade", "class_number", "student_number",
              "department", "position", "homeroom_class", "note"]:
        if f in body:
            setattr(e, f, body[f])
    await db.flush()
    await log_action(db, user, "enrollment.update", f"enroll:{eid}", request=request)
    return {"ok": True}


@router.delete("/semesters/{sid}/enrollments/{eid}")
async def delete_enrollment(
    sid: int, eid: int,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "명단 항목을 찾을 수 없습니다")
    await db.delete(e)
    await log_action(db, user, "enrollment.delete", f"enroll:{eid}", request=request)
    return {"ok": True}


# ── CSV 일괄 등록 (학기별 명단) ──

@router.get("/enrollments/csv-template/{role}")
async def get_csv_template(
    role: str,
    user: User = Depends(require_permission("system.enrollment.manage")),
):
    """CSV 양식 다운로드. role: teacher | student"""
    if role not in ("teacher", "student"):
        raise HTTPException(400, "role must be teacher|student")
    body = semester_template_csv(role)
    fname = f"{role}_template.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/semesters/{sid}/import-enrollments")
async def import_enrollments_endpoint(
    sid: int,
    role: str = Query(..., description="teacher | student"),
    dry_run: bool = Query(False),
    file: UploadFile = File(...),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학기별 명단 CSV 일괄 업로드.

    - role=teacher: department, name, phone
    - role=student: student_no, name, phone
    이름이 username이 되고, phone(숫자만)이 초기 비밀번호, must_change_password=True.
    """
    await get_semester_by_id_or_404(db, sid)
    if role not in ("teacher", "student"):
        raise HTTPException(400, "role must be teacher|student")

    file_bytes = await file.read()
    result = await import_enrollments_csv(db, sid, role, file_bytes, dry_run=dry_run)

    if not dry_run:
        await log_action(
            db, user, "enrollment.import",
            f"sem:{sid}/role:{role} ok={result['ok_count']} created={result['created_users']} reused={result['reused_users']}",
            request=request,
        )
    return result


# ── 진급/전출 마법사 ──

@router.post("/semesters/{from_sid}/promote-to/{to_sid}")
async def promote_enrollments(
    from_sid: int, to_sid: int,
    body: dict | None = None,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """이전 학기 명단을 대상 학기로 복제하면서 진급/졸업 처리.

    body:
      - promote_students: bool — 학생 학년 +1 (기본 True)
      - graduate_grade: int | null — 이 학년 학생은 status=graduated로 처리 (기본 3)
      - copy_teachers: bool — 교직원 그대로 복제 (기본 True)
      - dry_run: bool — 실제 반영 없이 결과 미리보기 (기본 False)
    """
    body = body or {}
    promote_students = bool(body.get("promote_students", True))
    graduate_grade = body.get("graduate_grade", 3)
    copy_teachers = bool(body.get("copy_teachers", True))
    dry_run = bool(body.get("dry_run", False))

    await get_semester_by_id_or_404(db, from_sid)
    await get_semester_by_id_or_404(db, to_sid)

    src = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == from_sid,
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    # 이미 대상 학기에 있는 user_id는 건너뜀
    existing_uids = set(
        (await db.execute(
            select(SemesterEnrollment.user_id).where(
                SemesterEnrollment.semester_id == to_sid
            )
        )).scalars().all()
    )

    promoted = 0
    graduated = 0
    copied = 0
    skipped = 0

    plan = []
    for e in src:
        if e.user_id in existing_uids:
            skipped += 1
            continue

        if e.role == "student":
            if not promote_students:
                skipped += 1
                continue
            new_grade = e.grade
            new_status = "active"
            if graduate_grade is not None and e.grade == graduate_grade:
                new_status = "graduated"
                graduated += 1
            else:
                new_grade = (e.grade or 0) + 1
                promoted += 1
            plan.append({
                "user_id": e.user_id,
                "role": "student",
                "from_grade": e.grade,
                "to_grade": new_grade if new_status == "active" else None,
                "status": new_status,
            })
            if not dry_run and new_status == "active":
                db.add(SemesterEnrollment(
                    semester_id=to_sid, user_id=e.user_id, role="student",
                    status="active",
                    grade=new_grade,
                    class_number=None,  # 반은 재배정 필요
                    student_number=None,
                ))
        elif e.role in ("teacher", "staff"):
            if not copy_teachers:
                skipped += 1
                continue
            copied += 1
            plan.append({
                "user_id": e.user_id,
                "role": e.role,
                "department": e.department,
            })
            if not dry_run:
                db.add(SemesterEnrollment(
                    semester_id=to_sid, user_id=e.user_id, role=e.role,
                    status="active",
                    department=e.department, position=e.position,
                    homeroom_class=None,  # 담임반은 재배정
                ))

    if not dry_run:
        await db.flush()
        await log_action(
            db, user, "enrollment.promote",
            f"from:{from_sid}->to:{to_sid} promoted={promoted} graduated={graduated} copied={copied}",
            request=request,
        )

    return {
        "dry_run": dry_run,
        "promoted": promoted,
        "graduated": graduated,
        "copied_teachers": copied,
        "skipped": skipped,
        "plan_preview": plan[:50],  # 최대 50건 미리보기
        "total_plan_count": len(plan),
    }


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
