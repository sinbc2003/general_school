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


def _safe_json_parse(s: str | None, default):
    """JSON 문자열 → Python 객체. 실패 시 default."""
    if not s:
        return default
    import json
    try:
        return json.loads(s)
    except Exception:
        return default


def _semester_to_dict(s: Semester) -> dict:
    return {
        "id": s.id, "year": s.year, "semester": s.semester,
        "name": s.name,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "end_date": s.end_date.isoformat() if s.end_date else None,
        "is_current": s.is_current,
        # 학교 구조 (드롭다운 용도)
        "classes_per_grade": _safe_json_parse(s.classes_per_grade, {}),
        "subjects": _safe_json_parse(s.subjects, []),
        "departments": _safe_json_parse(s.departments, []),
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


@router.put("/semesters/{sid}/structure")
async def update_semester_structure(
    sid: int, body: dict,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학기별 학교 구조 갱신.

    body 예:
      {
        "classes_per_grade": {"1": 5, "2": 5, "3": 4},
        "subjects": ["수학", "수학I", "물리", "화학"],
        "departments": ["수학과", "과학과", "행정실"]
      }
    각 필드는 선택. 빈 값 전송 시 그대로 둠 (None으로 만들려면 명시적 null).
    """
    import json
    s = await get_semester_by_id_or_404(db, sid)
    if "classes_per_grade" in body:
        v = body["classes_per_grade"]
        # 키를 문자열로 정규화
        if isinstance(v, dict):
            v = {str(k): int(val) for k, val in v.items()}
        s.classes_per_grade = json.dumps(v, ensure_ascii=False) if v is not None else None
    if "subjects" in body:
        v = body["subjects"]
        if isinstance(v, list):
            v = [str(x).strip() for x in v if str(x).strip()]
        s.subjects = json.dumps(v, ensure_ascii=False) if v is not None else None
    if "departments" in body:
        v = body["departments"]
        if isinstance(v, list):
            v = [str(x).strip() for x in v if str(x).strip()]
        s.departments = json.dumps(v, ensure_ascii=False) if v is not None else None
    await db.flush()
    await log_action(db, user, "semester.structure.update", f"semester:{sid}", request=request)
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

def _parse_csv_list(v: str | None) -> list:
    """콤마/공백 구분된 문자열 → 리스트. JSON 형식이면 그대로 파싱."""
    if not v:
        return []
    s = v.strip()
    if s.startswith("["):
        import json
        try:
            return json.loads(s)
        except Exception:
            pass
    return [x.strip() for x in s.replace("|", ",").replace(";", ",").split(",") if x.strip()]


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
        "subhomeroom_class": e.subhomeroom_class,
        "teaching_grades": _parse_csv_list(e.teaching_grades),
        "teaching_classes": _parse_csv_list(e.teaching_classes),
        "teaching_subjects": _parse_csv_list(e.teaching_subjects),
        "phone": e.phone,
        "note": e.note,
        "onboarded": bool(e.onboarded),
        "user": {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "name": u.name,
            "phone": u.phone,
        } if u else None,
    }


def _serialize_list_field(v) -> str | None:
    """list 또는 콤마 문자열 → 콤마 구분 문자열로 저장."""
    if v is None or v == "":
        return None
    if isinstance(v, list):
        return ",".join(str(x).strip() for x in v if str(x).strip())
    return str(v).strip() or None


@router.get("/my-enrollment")
async def get_my_enrollment(
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """본인의 (현재 학기 또는 지정 학기) enrollment 조회.

    교사 onboarding 페이지에서 본인 정보 + 학교 구조를 동시에 가져오는데 사용.
    enrollment이 없으면 None 반환 (super_admin은 보통 없음).
    """
    sid = semester_id or await get_active_semester_id_or_404(db)
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        )
    )).scalar_one_or_none()
    sem = await get_semester_by_id_or_404(db, sid)
    return {
        "enrollment": _enrollment_to_dict(e, user) if e else None,
        "semester": _semester_to_dict(sem),
    }


@router.put("/my-enrollment/onboarding")
async def submit_my_onboarding(
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """교사 본인 onboarding — 담임/부담임/수업 학년·학급·과목 입력 후 저장.

    body 예:
      {
        "semester_id": 1,                # 미지정 시 현재 학기
        "homeroom_class": "3-2",
        "subhomeroom_class": null,
        "teaching_grades": [1, 2],
        "teaching_classes": ["1-1","1-2","2-3"],
        "teaching_subjects": ["수학","수학I"]
      }
    저장 후 onboarded=True. 교사 본인 정보 수정도 같은 엔드포인트 재호출.
    """
    sid = body.get("semester_id") or await get_active_semester_id_or_404(db)
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "해당 학기 명단에 본인이 등록되어 있지 않습니다. 관리자에게 문의하세요.")

    for f in ["homeroom_class", "subhomeroom_class"]:
        if f in body:
            v = body[f]
            setattr(e, f, v.strip() if isinstance(v, str) and v.strip() else None)
    for f in ["teaching_grades", "teaching_classes", "teaching_subjects"]:
        if f in body:
            setattr(e, f, _serialize_list_field(body[f]))
    # 핸드폰 본인 갱신
    if "phone" in body and body["phone"]:
        e.phone = str(body["phone"]).strip()
        user.phone = e.phone

    e.onboarded = True
    await db.flush()
    await log_action(db, user, "enrollment.onboarding", f"sem:{sid}/user:{user.id}", request=request)
    return _enrollment_to_dict(e, user)


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
        subhomeroom_class=body.get("subhomeroom_class"),
        teaching_grades=_serialize_list_field(body.get("teaching_grades")),
        teaching_classes=_serialize_list_field(body.get("teaching_classes")),
        teaching_subjects=_serialize_list_field(body.get("teaching_subjects")),
        phone=body.get("phone"),
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
              "department", "position", "homeroom_class", "subhomeroom_class",
              "phone", "note"]:
        if f in body:
            setattr(e, f, body[f])
    # list 필드는 직렬화 후 저장
    for f in ["teaching_grades", "teaching_classes", "teaching_subjects"]:
        if f in body:
            setattr(e, f, _serialize_list_field(body[f]))
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
    full: bool = Query(False, description="True면 담임/수업 학년 등 모든 컬럼 포함"),
    user: User = Depends(require_permission("system.enrollment.manage")),
):
    """CSV 양식 다운로드. role: teacher | student.

    full=False (기본): 최소 컬럼만 (이름·핸드폰).
    full=True: 모든 컬럼 (담임/수업 학년 등 — 비워두고 웹에서 추후 입력 가능).
    """
    if role not in ("teacher", "student"):
        raise HTTPException(400, "role must be teacher|student")
    body = semester_template_csv(role, full=full)
    suffix = "_full" if full else ""
    fname = f"{role}{suffix}_template.csv"
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
