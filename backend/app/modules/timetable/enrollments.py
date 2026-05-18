"""학기 enrollment + 직책 권한 매핑 + CSV 일괄 등록 + 진급 마법사 endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import enrollments'로 등록.
"""

from datetime import datetime, timezone

from fastapi import Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import (
    get_active_semester_id_or_404,
    get_current_semester,
    get_semester_by_id_or_404,
)
from app.models.timetable import Semester, SemesterEnrollment
from app.models.user import User
from app.modules.timetable.schemas import (
    EnrollmentCreate,
    EnrollmentPositionsSet,
    EnrollmentUpdate,
    OnboardingSubmit,
    PromoteRequest,
)
from app.services.semester_import import (
    import_enrollments_csv,
    template_csv as semester_template_csv,
)

from app.modules.timetable.router import (
    router,
    _assert_semester_writable,
    _semester_to_dict,
)


# ── helpers (이전 router.py에서 이동) ──

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


def _enrollment_to_dict(
    e: SemesterEnrollment, u: User | None = None,
    position_count: int = 0,
) -> dict:
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
        "position_count": position_count,
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


def _enrollment_to_dict(
    e: SemesterEnrollment, u: User | None = None,
    position_count: int = 0,
) -> dict:
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
        # 직책 권한 할당 개수 (UI 행에 칩 표시용). 학생은 항상 0.
        "position_count": position_count,
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

    # 직책 할당 개수 일괄 조회 (행마다 1쿼리하지 않도록)
    from app.models.position import EnrollmentPosition as _EP
    from sqlalchemy import func as _sa_func
    eids = [e.id for (e, _u) in rows]
    pos_counts: dict[int, int] = {}
    if eids:
        cnt_rows = (await db.execute(
            select(_EP.enrollment_id, _sa_func.count(_EP.id))
            .where(_EP.enrollment_id.in_(eids))
            .group_by(_EP.enrollment_id)
        )).all()
        pos_counts = {eid: int(cnt) for eid, cnt in cnt_rows}

    return [
        _enrollment_to_dict(e, u, position_count=pos_counts.get(e.id, 0))
        for (e, u) in rows
    ]


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


# ── Enrollment Positions (학기 권한 위임) ──────────────────────────────
#
# enrollment 한 줄에 PositionTemplate 여러 개 할당 가능 ("3학년 담임" + "동아리
# 담당교사" + "정보 부장"). resolve_permissions가 현재 학기의 enrollment의
# 직책 → 권한을 자동 합산. 학기 종료 시 새 학기의 enrollment는 빈 상태로 시작
# → 자동 회수.


@router.get("/semesters/{sid}/enrollments/{eid}/positions")
async def list_enrollment_positions(
    sid: int, eid: int,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment에 할당된 직책 + 그 직책이 부여하는 권한 키 미리보기."""
    from app.models.position import PositionTemplate, EnrollmentPosition
    import json as _json

    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "enrollment 없음")

    rows = (await db.execute(
        select(EnrollmentPosition, PositionTemplate)
        .join(PositionTemplate, PositionTemplate.id == EnrollmentPosition.position_template_id)
        .where(EnrollmentPosition.enrollment_id == eid)
        .order_by(PositionTemplate.category, PositionTemplate.display_name)
    )).all()

    items = []
    for ep, pt in rows:
        try:
            perm_keys = _json.loads(pt.permission_keys or "[]")
        except (_json.JSONDecodeError, TypeError):
            perm_keys = []
        items.append({
            "id": ep.id,
            "template_id": pt.id,
            "template_key": pt.key,
            "display_name": pt.display_name,
            "category": pt.category,
            "permission_count": len(perm_keys),
            "note": ep.note,
        })
    return {"items": items}


@router.put("/semesters/{sid}/enrollments/{eid}/positions")
async def set_enrollment_positions(
    sid: int, eid: int, body: EnrollmentPositionsSet, request: Request,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment의 직책 목록을 통째로 교체 (PUT 의미).
    비우면 모든 직책 해제.
    """
    from app.models.position import PositionTemplate, EnrollmentPosition
    from sqlalchemy import delete as sql_delete

    await _assert_semester_writable(db, sid)
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "enrollment 없음")

    template_ids = sorted(set(body.template_ids))

    if template_ids:
        valid_ids = set((await db.execute(
            select(PositionTemplate.id).where(PositionTemplate.id.in_(template_ids))
        )).scalars().all())
        invalid = [t for t in template_ids if t not in valid_ids]
        if invalid:
            raise HTTPException(400, f"존재하지 않는 template_id: {invalid}")

    # 기존 매핑 일괄 삭제 후 새로 추가 (PUT 의미)
    await db.execute(
        sql_delete(EnrollmentPosition).where(EnrollmentPosition.enrollment_id == eid)
    )
    for tid in template_ids:
        db.add(EnrollmentPosition(
            enrollment_id=eid,
            position_template_id=tid,
            granted_by=user.id,
        ))
    await db.flush()

    # 대상 사용자의 세션 무효화 → stale 권한 차단
    from app.modules.permissions.router import _invalidate_user_sessions
    await _invalidate_user_sessions(db, e.user_id)
    await db.flush()

    await log_action(
        db, user, "enrollment_position.set",
        target=f"enroll:{eid} templates:{template_ids}", request=request,
    )
    return {"ok": True, "count": len(template_ids)}


@router.post("/semesters/{sid}/enrollments/{eid}/positions/sync-year")
async def sync_enrollment_positions_to_year(
    sid: int, eid: int, body: EnrollmentPositionsSet, request: Request,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment의 직책을 **같은 학년도의 다른 학기**에 동기화.

    운영 시나리오: 업무분장은 학년도 단위 → 1학기에 직책 바꾸면 2학기에도 적용.
    같은 user_id가 다른 학기에 active enrollment를 가지면 동일 template_ids로 PUT.
    """
    from app.models.position import PositionTemplate, EnrollmentPosition
    from sqlalchemy import delete as sql_delete

    await _assert_semester_writable(db, sid)
    src = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not src:
        raise HTTPException(404, "enrollment 없음")

    src_semester = await get_semester_by_id_or_404(db, sid)
    template_ids = sorted(set(body.template_ids))

    if template_ids:
        valid_ids = set((await db.execute(
            select(PositionTemplate.id).where(PositionTemplate.id.in_(template_ids))
        )).scalars().all())
        invalid = [t for t in template_ids if t not in valid_ids]
        if invalid:
            raise HTTPException(400, f"존재하지 않는 template_id: {invalid}")

    # 같은 학년도(year) 다른 학기의 같은 user enrollment (자기 자신 포함)
    targets = (await db.execute(
        select(SemesterEnrollment, Semester)
        .join(Semester, Semester.id == SemesterEnrollment.semester_id)
        .where(
            SemesterEnrollment.user_id == src.user_id,
            SemesterEnrollment.status == "active",
            Semester.year == src_semester.year,
        )
    )).all()

    synced: list[int] = []
    skipped: list[int] = []
    for target_enroll, target_sem in targets:
        if target_enroll.status != "active":
            skipped.append(target_sem.id)
            continue
        await db.execute(
            sql_delete(EnrollmentPosition).where(
                EnrollmentPosition.enrollment_id == target_enroll.id,
            )
        )
        for tid in template_ids:
            db.add(EnrollmentPosition(
                enrollment_id=target_enroll.id,
                position_template_id=tid,
                granted_by=user.id,
            ))
        synced.append(target_enroll.id)

    await db.flush()

    # 대상 사용자(같은 사용자의 학년도 전체 enrollment) 세션 무효화
    if synced:
        from app.modules.permissions.router import _invalidate_user_sessions
        await _invalidate_user_sessions(db, src.user_id)
        await db.flush()

    await log_action(
        db, user, "enrollment_position.sync_year",
        target=f"year:{src_semester.year} user:{src.user_id} count:{len(synced)}",
        request=request,
    )
    return {"ok": True, "synced_enrollments": synced, "skipped_semesters": skipped}


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

    from app.core.upload import validate_upload, POLICY_CSV
    file_bytes = await validate_upload(file, POLICY_CSV)
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


