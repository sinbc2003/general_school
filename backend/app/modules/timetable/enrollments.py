"""학기 enrollment 핵심 CRUD + 본인용/교사 대시보드 endpoints.

분할 구조:
- 본 파일: dashboard + self (my-enrollment) + 기본 CRUD
- enrollment_positions.py: 직책 권한 위임 (PositionTemplate ↔ Enrollment)
- enrollment_csv.py: CSV 일괄 등록 + 진급 마법사
- _helpers.py: 공유 직렬화·역직렬화

router 객체는 router.py에서 공유. router.py 끝의 'from . import enrollments'로 등록.
"""

from fastapi import Body, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import (
    get_active_semester_id_or_404,
    get_semester_by_id_or_404,
)
from app.models.timetable import SemesterEnrollment
from app.models.user import User
from app.modules.timetable.schemas import (
    EnrollmentCreate,
    EnrollmentUpdate,
    OnboardingSubmit,
)

from app.modules.timetable.router import (
    router,
    _assert_semester_writable,
    _semester_to_dict,
)
from app.modules.timetable._helpers import (
    _enrollment_to_dict,
    _parse_csv_list,
    _serialize_list_field,
)


# ── 교사 대시보드 ──

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


# ── 본인 enrollment (교사 onboarding) ──

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


# ── Semester Enrollments (학기별 명단) ──

@router.get("/semesters/{sid}/enrollments")
async def list_enrollments(
    sid: int,
    role: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=2000),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학기별 명단 조회 (페이지네이션).

    1400명 학교 기준 페이지당 100명 = 14페이지. per_page 최대 500 (관리자 전체 조회 시).
    응답: {items, total, page, per_page}
    """
    from sqlalchemy import func as _sa_func
    await get_semester_by_id_or_404(db, sid)
    base = (
        select(SemesterEnrollment, User)
        .join(User, User.id == SemesterEnrollment.user_id)
        .where(SemesterEnrollment.semester_id == sid)
    )
    if role:
        base = base.where(SemesterEnrollment.role == role)
    if status:
        base = base.where(SemesterEnrollment.status == status)

    # total count (페이지네이션 메타용)
    count_q = select(_sa_func.count()).select_from(base.subquery())
    total = int((await db.execute(count_q)).scalar() or 0)

    q = base.order_by(
        SemesterEnrollment.role,
        SemesterEnrollment.grade.asc().nulls_last(),
        SemesterEnrollment.class_number.asc().nulls_last(),
        SemesterEnrollment.student_number.asc().nulls_last(),
        User.name,
    ).offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(q)).all()

    # 직책 할당 개수 일괄 조회 (행마다 1쿼리하지 않도록)
    from app.models.position import EnrollmentPosition as _EP
    eids = [e.id for (e, _u) in rows]
    pos_counts: dict[int, int] = {}
    if eids:
        cnt_rows = (await db.execute(
            select(_EP.enrollment_id, _sa_func.count(_EP.id))
            .where(_EP.enrollment_id.in_(eids))
            .group_by(_EP.enrollment_id)
        )).all()
        pos_counts = {eid: int(cnt) for eid, cnt in cnt_rows}

    return {
        "items": [
            _enrollment_to_dict(e, u, position_count=pos_counts.get(e.id, 0))
            for (e, u) in rows
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("/enrollments/_set-homeroom")
async def set_homeroom(
    body: dict = Body(...),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학급 담임 매핑 — 교사의 현재학기 enrollment.homeroom_class 설정.

    body: {semester_id, user_id, grade, class_number}
    enrollment가 없으면 생성(학기 명단에 자동 등록). 온보딩 Step6에서 호출.
    학급 강좌 자동생성(course_seed)이 이 homeroom_class를 읽어 담임·학생을 연결한다.
    """
    sid = body.get("semester_id")
    uid = body.get("user_id")
    grade = body.get("grade")
    cls = body.get("class_number")
    if not all([sid, uid, grade, cls]):
        raise HTTPException(400, "semester_id/user_id/grade/class_number 모두 필요")
    homeroom = f"{int(grade)}-{int(cls)}"
    e = (await db.execute(select(SemesterEnrollment).where(
        SemesterEnrollment.semester_id == sid,
        SemesterEnrollment.user_id == uid,
    ))).scalar_one_or_none()
    if e:
        e.homeroom_class = homeroom
    else:
        target = await db.get(User, uid)
        db.add(SemesterEnrollment(
            semester_id=sid, user_id=uid,
            role=(target.role if target else "teacher"),
            status="active", homeroom_class=homeroom,
        ))
    await db.flush()
    await log_action(db, user, "enrollment.set_homeroom", f"sem:{sid}/user:{uid}/{homeroom}", request=request)
    return {"ok": True, "homeroom_class": homeroom}


@router.post("/semesters/{sid}/enrollments")
async def add_enrollment(
    sid: int, body: EnrollmentCreate,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await _assert_semester_writable(db, sid)
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
    await _assert_semester_writable(db, sid)
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
    await _assert_semester_writable(db, sid)
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
