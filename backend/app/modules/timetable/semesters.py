"""학기(Semester) CRUD + 학교 구조 + archive/unarchive endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import semesters'로 등록.
"""

from datetime import date, datetime, timezone

from fastapi import BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select, update as sql_update
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
)

from app.modules.timetable.router import router, _semester_to_dict


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
    copy_stats = {
        "enrollments": 0, "clubs": 0, "club_members": 0,
        "structure": False, "positions": 0,
    }
    if body.copy_from_semester_id:
        src = await get_semester_by_id_or_404(db, body.copy_from_semester_id)
        # 1) 학교 구조 (classes_per_grade / subjects / departments)
        if body.copy_structure:
            s.classes_per_grade = src.classes_per_grade
            s.subjects = src.subjects
            s.departments = src.departments
            copy_stats["structure"] = True
        # 2) Enrollments (학생/교사 명단)
        # src enrollment.id → new enrollment 객체 매핑 (positions 복사용)
        enrollment_map: dict[int, SemesterEnrollment] = {}
        if body.copy_enrollments:
            src_enrolls = (await db.execute(
                select(SemesterEnrollment).where(SemesterEnrollment.semester_id == src.id)
            )).scalars().all()
            for e in src_enrolls:
                # status가 transferred/graduated이면 새 학기에 복사하지 않음
                if e.status in ("transferred", "graduated"):
                    continue
                new_e = SemesterEnrollment(
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
                )
                db.add(new_e)
                enrollment_map[e.id] = new_e
                copy_stats["enrollments"] += 1
        # 2-1) Enrollment Positions (학기 직책 권한)
        # 디폴트 False — 학기마다 업무분장 재배정 시나리오 보호.
        # True인 경우 src의 EnrollmentPosition을 새 enrollment에 복제.
        if body.copy_positions and enrollment_map:
            from app.models.position import EnrollmentPosition as _EP
            await db.flush()  # enrollment_map 객체에 id 부여
            src_positions = (await db.execute(
                select(_EP).where(_EP.enrollment_id.in_(list(enrollment_map.keys())))
            )).scalars().all()
            for ep in src_positions:
                new_e = enrollment_map.get(ep.enrollment_id)
                if not new_e:
                    continue
                db.add(_EP(
                    enrollment_id=new_e.id,
                    position_template_id=ep.position_template_id,
                    granted_by=user.id,
                    note=ep.note,
                ))
                copy_stats["positions"] += 1
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
    background: BackgroundTasks,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """이 학기를 현재 학기로 지정 (다른 모든 학기는 is_current=False).
    archived 학기는 현재 학기로 지정 불가.

    학기 전환 직후 전체 사용자 '내 드라이브' 자동 폴더를 새 학기 기준으로
    백그라운드 동기화한다(이전 학기 폴더는 보존·누적, sort_order 충돌 없음).
    """
    s = await get_semester_by_id_or_404(db, sid)
    if s.is_archived:
        raise HTTPException(400, "보관된 학기는 현재 학기로 지정할 수 없습니다. 먼저 보관 해제하세요.")
    # 이전 현재 학기 — 전환 후 자동 폴더 아카이브 대상
    prev = (await db.execute(
        select(Semester).where(Semester.is_current == True)  # noqa: E712
    )).scalars().first()
    await db.execute(sql_update(Semester).values(is_current=False))
    s.is_current = True
    await db.flush()
    await log_action(db, user, "semester.set_current", f"semester:{sid}", request=request)
    # 새 학기 기준 전체 드라이브 폴더 자동 생성 (백그라운드 — 응답 막지 않음)
    from app.services.folder_seed import (
        archive_prev_semester_background, sync_all_users_background,
    )
    # 이전 학기 자동 폴더 → "{n}. {year}-{term}학기" 보관 폴더로 이동 (멱등)
    if prev and prev.id != sid:
        background.add_task(archive_prev_semester_background, prev.id, sid)
    background.add_task(sync_all_users_background, sid)
    return _semester_to_dict(s)


@router.post("/semesters/{sid}/archive")
async def archive_semester(
    sid: int, request: Request,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학기 보관 (종료).
    - is_archived=True 설정 → 모든 쓰기 차단 (조회만 가능)
    - is_current=True인 학기는 보관 불가 (먼저 다른 학기를 현재로 지정)
    - 보관 시각 기록 (archived_at)
    - enrollment positions·시간표는 그대로 보존 (히스토리/생기부용)
    """
    from datetime import datetime as _dt, timezone as _tz
    s = await get_semester_by_id_or_404(db, sid)
    if s.is_archived:
        return _semester_to_dict(s)  # 이미 보관됨 — 멱등
    if s.is_current:
        raise HTTPException(
            400,
            "현재 학기는 보관할 수 없습니다. 다른 학기를 현재 학기로 지정한 후 보관하세요.",
        )
    s.is_archived = True
    s.archived_at = _dt.now(_tz.utc)
    await db.flush()
    await log_action(db, user, "semester.archive", f"semester:{sid}", request=request, is_sensitive=True)
    return _semester_to_dict(s)


@router.post("/semesters/{sid}/unarchive")
async def unarchive_semester(
    sid: int, request: Request,
    user: User = Depends(require_permission("system.semester.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학기 보관 해제 — 쓰기 다시 허용."""
    s = await get_semester_by_id_or_404(db, sid)
    if not s.is_archived:
        return _semester_to_dict(s)  # 이미 해제 — 멱등
    s.is_archived = False
    s.archived_at = None
    await db.flush()
    await log_action(db, user, "semester.unarchive", f"semester:{sid}", request=request)
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


