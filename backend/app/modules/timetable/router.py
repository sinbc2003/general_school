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
from app.modules.timetable.schemas import (
    SemesterCreate,
    SemesterUpdate,
    SemesterStructureUpdate,
    EnrollmentCreate,
    EnrollmentUpdate,
    OnboardingSubmit,
    PromoteRequest,
)
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
    body: SemesterCreate,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학기 생성 — Pydantic SemesterCreate로 입력 자동 검증 (year/semester/날짜 범위)."""
    # 중복 체크
    exists = (await db.execute(
        select(Semester).where(Semester.year == body.year, Semester.semester == body.semester)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, f"이미 {body.year}년 {body.semester}학기가 존재합니다")

    if body.is_current:
        await db.execute(sql_update(Semester).values(is_current=False))

    s = Semester(
        year=body.year, semester=body.semester,
        name=body.name or f"{body.year}학년도 {body.semester}학기",
        start_date=body.start_date,
        end_date=body.end_date,
        is_current=body.is_current,
    )
    db.add(s)
    await db.flush()

    # ── 이전 학기 데이터 복사 (옵션) ──
    copy_stats = {"enrollments": 0, "clubs": 0, "club_members": 0, "structure": False}
    if body.copy_from_semester_id:
        src = await get_semester_by_id_or_404(db, body.copy_from_semester_id)
        # 1) 학교 구조 (classes_per_grade / subjects / departments)
        if body.copy_structure:
            s.classes_per_grade = src.classes_per_grade
            s.subjects = src.subjects
            s.departments = src.departments
            copy_stats["structure"] = True
        # 2) Enrollments (학생/교사 명단)
        if body.copy_enrollments:
            src_enrolls = (await db.execute(
                select(SemesterEnrollment).where(SemesterEnrollment.semester_id == src.id)
            )).scalars().all()
            for e in src_enrolls:
                # status가 transferred/graduated이면 새 학기에 복사하지 않음
                if e.status in ("transferred", "graduated"):
                    continue
                db.add(SemesterEnrollment(
                    semester_id=s.id,
                    user_id=e.user_id,
                    role=e.role,
                    status="active",
                    grade=e.grade,
                    class_number=e.class_number,
                    student_number=e.student_number,
                    department=e.department,
                    position=e.position,
                    homeroom_class=e.homeroom_class,
                    subhomeroom_class=e.subhomeroom_class,
                    teaching_grades=e.teaching_grades,
                    teaching_classes=e.teaching_classes,
                    teaching_subjects=e.teaching_subjects,
                    phone=e.phone,
                    note=e.note,
                ))
                copy_stats["enrollments"] += 1
        # 3) Clubs + members
        if body.copy_clubs:
            from app.models.club import Club
            src_clubs = (await db.execute(
                select(Club).where(Club.semester_id == src.id)
            )).scalars().all()
            for c in src_clubs:
                new_club = Club(
                    semester_id=s.id,
                    name=c.name,
                    description=c.description,
                    advisor_id=c.advisor_id,
                    members=list(c.members or []),
                    year=body.year,
                    status="active",
                    budget=c.budget,
                    is_active=True,
                )
                db.add(new_club)
                copy_stats["clubs"] += 1
                copy_stats["club_members"] += len(c.members or [])
        await db.flush()

    await log_action(
        db, user, "semester.create",
        f"semester:{s.id}" + (f" copied_from:{body.copy_from_semester_id}" if body.copy_from_semester_id else ""),
        request=request,
    )
    result = _semester_to_dict(s)
    result["copied"] = copy_stats
    return result


@router.put("/semesters/{sid}")
async def update_semester(
    sid: int, body: SemesterUpdate,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    s = await get_semester_by_id_or_404(db, sid)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    await db.flush()
    await log_action(db, user, "semester.update", f"semester:{sid}", request=request)
    return _semester_to_dict(s)


@router.put("/semesters/{sid}/structure")
async def update_semester_structure(
    sid: int, body: SemesterStructureUpdate,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학기별 학교 구조 갱신 (드롭다운 표준화 소스)."""
    import json
    s = await get_semester_by_id_or_404(db, sid)
    data = body.model_dump(exclude_unset=True)
    if "classes_per_grade" in data and data["classes_per_grade"] is not None:
        v = {str(k): int(val) for k, val in data["classes_per_grade"].items()}
        s.classes_per_grade = json.dumps(v, ensure_ascii=False)
    if "subjects" in data and data["subjects"] is not None:
        v = [x.strip() for x in data["subjects"] if x.strip()]
        s.subjects = json.dumps(v, ensure_ascii=False)
    if "departments" in data and data["departments"] is not None:
        v = [x.strip() for x in data["departments"] if x.strip()]
        s.departments = json.dumps(v, ensure_ascii=False)
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


@router.get("/teacher-dashboard-stats")
async def teacher_dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """교사 대시보드용 — 현재 학기 기준 담당 학생 학년별 분포 + 핵심 통계.

    정책 무관 본인 enrollment 기반 (담임/부담임/수업 학년·학급).
    """
    from app.core.visibility import visible_student_user_ids
    from sqlalchemy import func as sa_func

    if user.role not in ("teacher", "staff"):
        return {"by_grade": {}, "total": 0, "homeroom_class": None, "subhomeroom_class": None}

    try:
        sid = await get_active_semester_id_or_404(db)
    except HTTPException:
        return {"by_grade": {}, "total": 0, "homeroom_class": None, "subhomeroom_class": None}

    visible = await visible_student_user_ids(db, user, sid)

    # 본인 enrollment
    my_enroll = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        )
    )).scalar_one_or_none()

    # 학년별 학생 수 (visible 적용)
    q = (
        select(SemesterEnrollment.grade, sa_func.count(SemesterEnrollment.id))
        .where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.role == "student",
            SemesterEnrollment.status == "active",
        )
        .group_by(SemesterEnrollment.grade)
    )
    if visible is not None:  # None = 무제한 (관리자 등)
        if not visible:
            return {
                "by_grade": {}, "total": 0,
                "homeroom_class": my_enroll.homeroom_class if my_enroll else None,
                "subhomeroom_class": my_enroll.subhomeroom_class if my_enroll else None,
            }
        q = q.where(SemesterEnrollment.user_id.in_(visible))
    rows = (await db.execute(q)).all()
    by_grade = {str(r[0]): int(r[1]) for r in rows if r[0] is not None}
    total = sum(by_grade.values())

    return {
        "by_grade": by_grade,
        "total": total,
        "homeroom_class": my_enroll.homeroom_class if my_enroll else None,
        "subhomeroom_class": my_enroll.subhomeroom_class if my_enroll else None,
        "teaching_grades": _parse_csv_list(my_enroll.teaching_grades) if my_enroll else [],
    }


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
    body: OnboardingSubmit,
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
    sid = body.semester_id or await get_active_semester_id_or_404(db)
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "해당 학기 명단에 본인이 등록되어 있지 않습니다. 관리자에게 문의하세요.")

    data = body.model_dump(exclude_unset=True)
    for f in ["homeroom_class", "subhomeroom_class"]:
        if f in data:
            v = data[f]
            setattr(e, f, v.strip() if isinstance(v, str) and v.strip() else None)
    for f in ["teaching_grades", "teaching_classes", "teaching_subjects"]:
        if f in data:
            setattr(e, f, _serialize_list_field(data[f]))
    if data.get("phone"):
        e.phone = str(data["phone"]).strip()
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
    sid: int, body: EnrollmentCreate,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await get_semester_by_id_or_404(db, sid)
    uid = body.user_id
    target = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "대상 사용자를 찾을 수 없습니다")
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
        role=body.role or target.role,
        status=body.status,
        grade=body.grade,
        class_number=body.class_number,
        student_number=body.student_number,
        department=body.department,
        position=body.position,
        homeroom_class=body.homeroom_class,
        subhomeroom_class=body.subhomeroom_class,
        teaching_grades=_serialize_list_field(body.teaching_grades),
        teaching_classes=_serialize_list_field(body.teaching_classes),
        teaching_subjects=_serialize_list_field(body.teaching_subjects),
        phone=body.phone,
        note=body.note,
    )
    db.add(e)
    await db.flush()
    await log_action(db, user, "enrollment.add", f"sem:{sid}/user:{uid}", request=request)
    return _enrollment_to_dict(e, target)


@router.put("/semesters/{sid}/enrollments/{eid}")
async def update_enrollment(
    sid: int, eid: int, body: EnrollmentUpdate,
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
    data = body.model_dump(exclude_unset=True)
    for f in ["role", "status", "grade", "class_number", "student_number",
              "department", "position", "homeroom_class", "subhomeroom_class",
              "phone", "note"]:
        if f in data:
            setattr(e, f, data[f])
    for f in ["teaching_grades", "teaching_classes", "teaching_subjects"]:
        if f in data:
            setattr(e, f, _serialize_list_field(data[f]))
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
    body: PromoteRequest = PromoteRequest(),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """이전 학기 명단을 대상 학기로 복제하면서 진급/졸업 처리."""
    promote_students = body.promote_students
    graduate_grade = body.graduate_grade
    copy_teachers = body.copy_teachers
    dry_run = body.dry_run

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


# ── 교사 본인 개인 일정 (회의/면담/행사) ─────────────────────────────────
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
