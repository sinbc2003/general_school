"""클래스룸 라우터 — 강좌 CRUD + 자동 생성 + 학생 명단 + 글.

경로:
  GET    /api/classroom/courses                  본인 관련 강좌 (교사·학생)
  GET    /api/classroom/courses/all              관리자: 전체 강좌
  POST   /api/classroom/courses                  강좌 생성

  NOTE: list / create endpoint는 명시적으로 "/courses"에 등록 (frontend 호출과 일치).
        과거 빈 path("")에 등록되어 있어 frontend POST /courses가 404였음.
  PUT    /api/classroom/courses/{cid}            편집
  DELETE /api/classroom/courses/{cid}            삭제
  POST   /api/classroom/courses/_auto-generate   학기 enrollment 기반 자동 생성

  GET    /api/classroom/courses/{cid}            강좌 상세 + 학생 명단 + 최근 글
  POST   /api/classroom/courses/{cid}/students   학생 추가
  POST   /api/classroom/courses/{cid}/students/bulk 일괄 추가 (학번 list)
  DELETE /api/classroom/courses/{cid}/students/{sid}

  GET    /api/classroom/courses/{cid}/posts      글 목록
  POST   /api/classroom/courses/{cid}/posts      글 작성
  PUT    /api/classroom/posts/{pid}              글 편집
  DELETE /api/classroom/posts/{pid}              글 삭제

학생 명단 자동 등록 (학급 단위 강좌):
  class_name="2-3"이면 해당 학기 enrollment(role=student, grade=2, class_number=3)
  학생을 자동 등록.
"""

import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404, resolve_semester_id
from app.models.classroom import Course, CoursePost, CourseStudent
from app.models.timetable import Semester, SemesterEnrollment
from app.models.user import User
from app.modules.classroom.schemas import (
    AutoGenerateRequest, CourseCreate,
    CourseStudentAdd, CourseStudentBulk, CourseUpdate,
)

router = APIRouter(prefix="/api/classroom", tags=["classroom"])


# ── helpers ────────────────────────────────────────────────


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


def _course_to_dict(c: Course, student_count: int = 0) -> dict:
    return {
        "id": c.id,
        "semester_id": c.semester_id,
        "teacher_id": c.teacher_id,
        "subject": c.subject,
        "class_name": c.class_name,
        "name": c.name,
        "description": c.description,
        "is_active": c.is_active,
        "student_count": student_count,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        # Phase 1.0 확장 (카드 디자인 + 강좌 타입 + 열람 권한)
        "course_type": getattr(c, "course_type", "subject"),
        "grade_level": getattr(c, "grade_level", None),
        "banner_color": getattr(c, "banner_color", None),
        "banner_image_url": getattr(c, "banner_image_url", None),
        "icon": getattr(c, "icon", None),
        "viewable_by": getattr(c, "viewable_by", "all_teachers"),
    }


def _post_to_dict(p: CoursePost, author_name: str | None = None) -> dict:
    return {
        "id": p.id,
        "course_id": p.course_id,
        "author_id": p.author_id,
        "author_name": author_name,
        "post_type": p.post_type,
        "title": p.title,
        "content": p.content,
        "file_url": p.file_url,
        "file_name": p.file_name,
        "is_pinned": p.is_pinned,
        # 과제 메타
        "due_date": p.due_date.isoformat() if p.due_date else None,
        "max_score": p.max_score,
        "topic": p.topic,
        "attachments": p.attachments or [],
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


async def _assert_course_access(
    db: AsyncSession, user: User, course: Course,
) -> str:
    """강좌 접근 권한 검증. role 반환 ('teacher' / 'student' / 'admin').

    - admin: 모든 강좌
    - 교사: owner 또는 co_teacher (SSOT — is_course_editor)
    - 학생: CourseStudent에 active로 등록된 경우
    그 외: 403.
    """
    if _is_admin(user):
        return "admin"
    # owner + co_teacher (CourseTeacher M2M) — SSOT
    from app.modules.classroom.teachers import is_course_editor
    if await is_course_editor(db, course, user):
        return "teacher"
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if cs:
        return "student"
    raise HTTPException(403, "해당 강좌 접근 권한이 없습니다")


def _parse_teaching_list(s: str | None) -> list[str]:
    """teaching_grades / teaching_classes / teaching_subjects 파싱.
    JSON list, CSV, |/; 구분 모두 허용 (timetable enrollment에서 다양한 입력).
    """
    if not s:
        return []
    s = s.strip()
    # JSON list 시도
    if s.startswith("["):
        try:
            data = json.loads(s)
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
        except json.JSONDecodeError:
            pass
    # CSV / | / ;
    for sep in (",", "|", ";"):
        if sep in s:
            return [x.strip() for x in s.split(sep) if x.strip()]
    return [s] if s else []


# ── 강좌 CRUD ──────────────────────────────────────────────


@router.get("/courses")
async def list_my_courses(
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인 관련 강좌 목록.

    - 교사: teacher_id == user.id
    - 학생: CourseStudent에 등록된 강좌
    - admin: 모든 강좌
    """
    sid = semester_id or await get_active_semester_id_or_404(db)
    q = select(Course).where(Course.semester_id == sid)
    if user.role == "student":
        q = q.join(CourseStudent, CourseStudent.course_id == Course.id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    elif user.role in ("teacher", "staff"):
        q = q.where(Course.teacher_id == user.id)
    # admin은 전체
    rows = (await db.execute(q.order_by(Course.subject, Course.class_name))).scalars().all()

    # student_count 집계
    counts: dict[int, int] = {}
    if rows:
        cnt_q = (await db.execute(
            select(CourseStudent.course_id, func.count(CourseStudent.id))
            .where(CourseStudent.course_id.in_([c.id for c in rows]),
                   CourseStudent.status == "active")
            .group_by(CourseStudent.course_id)
        )).all()
        counts = dict(cnt_q)

    return {"items": [_course_to_dict(c, counts.get(c.id, 0)) for c in rows]}


@router.get("/courses/_archived")
async def list_my_archived_courses(
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 가르쳤거나 수강했던 **과거 학기** 강좌 (read-only 열람용).

    - 교사: teacher_id == user.id AND semester_id != active
    - 학생: CourseStudent에 본인 등록된 강좌 (status 무관 — dropped/transferred 포함)
            AND semester_id != active
    - admin: 모든 과거 학기 강좌

    Google Classroom의 "보관된 강좌" 메뉴와 동일 — 본인 관련만, read-only.
    """
    active_sid = await get_active_semester_id_or_404(db)

    base = select(Course).where(Course.semester_id != active_sid)
    if user.role == "student":
        # status 무관 — 졸업·전학 학생도 본인 데이터 열람
        base = base.join(CourseStudent, CourseStudent.course_id == Course.id).where(
            CourseStudent.student_id == user.id,
        )
    elif user.role in ("teacher", "staff"):
        base = base.where(Course.teacher_id == user.id)
    # admin은 전체 과거 학기

    rows = (await db.execute(
        base.order_by(desc(Course.semester_id), Course.subject, Course.class_name)
    )).scalars().all()

    counts: dict[int, int] = {}
    if rows:
        cnt_q = (await db.execute(
            select(CourseStudent.course_id, func.count(CourseStudent.id))
            .where(CourseStudent.course_id.in_([c.id for c in rows]),
                   CourseStudent.status == "active")
            .group_by(CourseStudent.course_id)
        )).all()
        counts = dict(cnt_q)

    # 학기명 + 교사명 일괄
    sem_ids = {c.semester_id for c in rows}
    sems: dict[int, dict] = {}
    if sem_ids:
        srows = (await db.execute(select(Semester).where(Semester.id.in_(sem_ids)))).scalars().all()
        sems = {s.id: {"name": s.name, "year": s.year, "term": s.term} for s in srows}
    teacher_ids = {c.teacher_id for c in rows}
    teachers: dict[int, str] = {}
    if teacher_ids:
        urows = (await db.execute(select(User).where(User.id.in_(teacher_ids)))).scalars().all()
        teachers = {u.id: u.name for u in urows}

    items = []
    for c in rows:
        d = _course_to_dict(c, counts.get(c.id, 0))
        d["teacher_name"] = teachers.get(c.teacher_id)
        d["semester"] = sems.get(c.semester_id)
        d["is_past_semester"] = True
        items.append(d)
    return {"items": items, "active_semester_id": active_sid}


@router.get("/courses/all")
async def list_all_courses(
    semester_id: int | None = Query(None),
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """관리자: 학기 전체 강좌."""
    if not _is_admin(user):
        raise HTTPException(403, "관리자만 전체 강좌 조회 가능")
    sid = semester_id or await get_active_semester_id_or_404(db)
    rows = (await db.execute(
        select(Course).where(Course.semester_id == sid)
        .order_by(Course.subject, Course.class_name, Course.name)
    )).scalars().all()

    counts: dict[int, int] = {}
    if rows:
        cnt_q = (await db.execute(
            select(CourseStudent.course_id, func.count(CourseStudent.id))
            .where(CourseStudent.course_id.in_([c.id for c in rows]),
                   CourseStudent.status == "active")
            .group_by(CourseStudent.course_id)
        )).all()
        counts = dict(cnt_q)

    # 교사 이름 일괄 조회
    teacher_ids = {c.teacher_id for c in rows}
    teachers: dict[int, str] = {}
    if teacher_ids:
        urows = (await db.execute(select(User).where(User.id.in_(teacher_ids)))).scalars().all()
        teachers = {u.id: u.name for u in urows}

    items = []
    for c in rows:
        d = _course_to_dict(c, counts.get(c.id, 0))
        d["teacher_name"] = teachers.get(c.teacher_id)
        items.append(d)
    return {"items": items}


@router.post("/courses")
async def create_course(
    body: CourseCreate, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    sid = await resolve_semester_id(
        {"semester_id": body.semester_id} if body.semester_id else None, db,
    )
    # 권한: admin이거나 본인이 그 강좌 교사면 OK
    if not _is_admin(user) and user.id != body.teacher_id:
        raise HTTPException(403, "본인 강좌만 생성 가능합니다 (또는 관리자)")

    # 중복 체크 (UniqueConstraint로도 막히지만 사전 안내)
    dup = (await db.execute(
        select(Course).where(
            Course.semester_id == sid,
            Course.teacher_id == body.teacher_id,
            Course.subject == body.subject,
            Course.class_name == body.class_name,
        )
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "동일한 교사·과목·학급 조합의 강좌가 이미 존재합니다")

    c = Course(
        semester_id=sid,
        teacher_id=body.teacher_id,
        subject=body.subject,
        class_name=body.class_name,
        name=body.name,
        description=body.description,
    )
    db.add(c)
    await db.flush()

    # 자동 폴더 동기화 (owner의 subject_teaching). best-effort.
    try:
        from app.services.folder_seed import on_course_teacher_assigned
        await on_course_teacher_assigned(db, course_id=c.id, user_id=body.teacher_id)
    except Exception:
        pass

    await log_action(db, user, "classroom.course.create", target=f"course:{c.id}", request=request)
    return _course_to_dict(c)


@router.put("/courses/{cid}")
async def update_course(
    cid: int, body: CourseUpdate, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not _is_admin(user) and c.teacher_id != user.id:
        raise HTTPException(403, "본인 강좌만 편집 가능")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(c, k, v)
    await db.flush()
    await log_action(db, user, "classroom.course.update", target=f"course:{cid}", request=request)
    return _course_to_dict(c)


@router.delete("/courses/{cid}")
async def delete_course(
    cid: int, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not _is_admin(user) and c.teacher_id != user.id:
        raise HTTPException(403, "본인 강좌만 삭제 가능")
    await db.delete(c)
    await log_action(db, user, "classroom.course.delete", target=f"course:{cid}", request=request)
    return {"ok": True}


# ── 자동 생성 ──────────────────────────────────────────────


@router.post("/courses/_auto-generate")
async def auto_generate_courses(
    body: AutoGenerateRequest, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학기 enrollment의 teaching_classes × teaching_subjects 조합으로 강좌 자동 생성.

    - 멱등: 이미 존재하는 강좌는 skip
    - auto_enroll_students=True면 학급 단위 강좌(class_name="X-Y")에 학생 자동 등록
    """
    if not _is_admin(user):
        raise HTTPException(403, "관리자만 자동 생성 가능")
    sid = body.semester_id or await get_active_semester_id_or_404(db)

    # 모든 교사 enrollment 조회
    teacher_enrolls = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.role.in_(["teacher", "staff"]),
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    # 학생 enrollment 조회 (자동 등록용)
    student_enrolls = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.role == "student",
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()
    # (grade, class_number) → [student_id list]
    students_by_class: dict[tuple[int, int], list[int]] = {}
    for se in student_enrolls:
        if se.grade is not None and se.class_number is not None:
            key = (se.grade, se.class_number)
            students_by_class.setdefault(key, []).append(se.user_id)

    # 기존 강좌 (중복 회피)
    existing = (await db.execute(
        select(Course).where(Course.semester_id == sid)
    )).scalars().all()
    existing_keys = {
        (c.teacher_id, c.subject, c.class_name) for c in existing
    }

    created = 0
    enrolled = 0
    skipped = 0

    for enr in teacher_enrolls:
        subjects = _parse_teaching_list(enr.teaching_subjects)
        classes = _parse_teaching_list(enr.teaching_classes)
        if not subjects:
            continue
        # 학급 단위: teaching_classes가 있으면 그 조합. 없으면 선택과목 (class_name=None)
        if classes:
            for class_name in classes:
                for subject in subjects:
                    key = (enr.user_id, subject, class_name)
                    if key in existing_keys:
                        skipped += 1
                        continue
                    name = f"{class_name} {subject}"
                    c = Course(
                        semester_id=sid,
                        teacher_id=enr.user_id,
                        subject=subject,
                        class_name=class_name,
                        name=name,
                    )
                    db.add(c)
                    await db.flush()
                    existing_keys.add(key)
                    created += 1

                    if body.auto_enroll_students:
                        # class_name="2-3" → (2, 3)
                        try:
                            g, cn = class_name.split("-", 1)
                            student_ids = students_by_class.get((int(g), int(cn)), [])
                            for sid_user in student_ids:
                                db.add(CourseStudent(course_id=c.id, student_id=sid_user))
                                enrolled += 1
                        except (ValueError, IndexError):
                            pass
        else:
            # 선택과목: class_name=None
            for subject in subjects:
                key = (enr.user_id, subject, None)
                if key in existing_keys:
                    skipped += 1
                    continue
                c = Course(
                    semester_id=sid,
                    teacher_id=enr.user_id,
                    subject=subject,
                    class_name=None,
                    name=subject,
                )
                db.add(c)
                await db.flush()
                existing_keys.add(key)
                created += 1
                # 선택과목은 자동 학생 등록 불가 (교사가 명단 따로 등록)

    await db.flush()

    # 자동 강좌 생성 후 영향 사용자 일괄 폴더 동기화 (best-effort).
    if created or enrolled:
        try:
            from app.services.folder_seed import sync_all_users
            await sync_all_users(db, sid)
        except Exception:
            pass

    await log_action(
        db, user, "classroom.course.auto_generate",
        target=f"sid:{sid} created:{created} enrolled:{enrolled} skipped:{skipped}",
        request=request,
    )
    return {
        "created": created,
        "enrolled_students": enrolled,
        "skipped_existing": skipped,
    }


# ── 강좌 상세 ──────────────────────────────────────────────


@router.get("/courses/{cid}")
async def get_course_detail(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    role = await _assert_course_access(db, user, c)

    # 학생 명단
    rows = (await db.execute(
        select(CourseStudent, User)
        .join(User, User.id == CourseStudent.student_id)
        .where(CourseStudent.course_id == cid, CourseStudent.status == "active")
        .order_by(User.grade, User.class_number, User.student_number, User.name)
    )).all()
    students = [
        {
            "id": cs.id,
            "student_id": u.id,
            "name": u.name,
            "grade": u.grade,
            "class_number": u.class_number,
            "student_number": u.student_number,
            "joined_at": cs.joined_at.isoformat() if cs.joined_at else None,
        }
        for cs, u in rows
    ]

    # 교사 이름
    teacher = await db.get(User, c.teacher_id)

    # 과거 학기 강좌인지 — read-only 모드 판단 (Google 식 보관 정책)
    active_sid = await get_active_semester_id_or_404(db)
    is_past = c.semester_id != active_sid

    # 학기 정보 (이전 학기 강좌일 때 frontend 표시용)
    semester_info = None
    if is_past:
        s = await db.get(Semester, c.semester_id)
        if s:
            semester_info = {"name": s.name, "year": s.year, "term": s.term}

    return {
        **_course_to_dict(c, len(students)),
        "teacher_name": teacher.name if teacher else None,
        "students": students,
        "viewer_role": role,
        "is_past_semester": is_past,
        "semester": semester_info,
    }


# ── 학생 명단 관리 ───────────────────────────────────────


@router.post("/courses/{cid}/students")
async def add_student_to_course(
    cid: int, body: CourseStudentAdd, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not _is_admin(user) and c.teacher_id != user.id:
        raise HTTPException(403, "본인 강좌만 학생 등록 가능")

    student = await db.get(User, body.student_id)
    if not student or student.role != "student":
        raise HTTPException(400, "유효한 학생이 아닙니다")

    # 중복 체크
    dup = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == cid,
            CourseStudent.student_id == body.student_id,
        )
    )).scalar_one_or_none()
    if dup:
        if dup.status != "active":
            dup.status = "active"
            await db.flush()
            return {"ok": True, "reactivated": True}
        raise HTTPException(409, "이미 등록된 학생")

    cs = CourseStudent(course_id=cid, student_id=body.student_id)
    db.add(cs)
    await db.flush()

    # 자동 폴더 동기화 (학생 수강과목 wrapper + 안 강좌 폴더). best-effort.
    try:
        from app.services.folder_seed import on_course_student_enrolled
        await on_course_student_enrolled(db, course_id=cid, student_id=body.student_id)
    except Exception:
        pass

    await log_action(
        db, user, "classroom.student.add",
        target=f"course:{cid} student:{body.student_id}", request=request,
    )
    return {"ok": True, "id": cs.id}


@router.post("/courses/{cid}/students/bulk")
async def bulk_add_students(
    cid: int, body: CourseStudentBulk, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학번(student_number) 또는 user_id list로 일괄 등록.

    이미 등록(active)된 학생은 skip. dropped → active 재활성화.
    """
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not _is_admin(user) and c.teacher_id != user.id:
        raise HTTPException(403, "본인 강좌만 일괄 등록 가능")

    # 학번 → user_id 매핑
    target_user_ids: set[int] = set(body.user_ids or [])
    if body.student_numbers:
        rows = (await db.execute(
            select(User).where(
                User.role == "student",
                User.student_number.in_(body.student_numbers),
            )
        )).scalars().all()
        target_user_ids.update(u.id for u in rows)

    if not target_user_ids:
        return {"added": 0, "skipped": 0, "reactivated": 0, "errors": ["대상 학생 없음"]}

    # 기존 등록 조회
    existing = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == cid,
            CourseStudent.student_id.in_(target_user_ids),
        )
    )).scalars().all()
    by_uid = {cs.student_id: cs for cs in existing}

    added = 0
    skipped = 0
    reactivated = 0
    for uid in target_user_ids:
        if uid in by_uid:
            cs = by_uid[uid]
            if cs.status == "active":
                skipped += 1
            else:
                cs.status = "active"
                reactivated += 1
        else:
            db.add(CourseStudent(course_id=cid, student_id=uid))
            added += 1

    await db.flush()

    # 자동 폴더 동기화 — 새로 추가/재활성화된 학생 모두 (best-effort).
    if added or reactivated:
        try:
            from app.services.folder_seed import on_course_student_enrolled
            for uid in target_user_ids:
                await on_course_student_enrolled(db, course_id=cid, student_id=uid)
        except Exception:
            pass

    await log_action(
        db, user, "classroom.student.bulk_add",
        target=f"course:{cid} added:{added} reactivated:{reactivated} skipped:{skipped}",
        request=request,
    )
    return {"added": added, "skipped": skipped, "reactivated": reactivated}


@router.delete("/courses/{cid}/students/{sid}")
async def remove_student_from_course(
    cid: int, sid: int, request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not _is_admin(user) and c.teacher_id != user.id:
        raise HTTPException(403, "본인 강좌만")

    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == cid,
            CourseStudent.student_id == sid,
        )
    )).scalar_one_or_none()
    if not cs:
        raise HTTPException(404)
    cs.status = "dropped"
    await db.flush()
    await log_action(
        db, user, "classroom.student.drop",
        target=f"course:{cid} student:{sid}", request=request,
    )
    return {"ok": True}


# Sub-modules — 등록 강제 (마지막에 import해 순환 회피)
from app.modules.classroom import posts  # noqa: E402, F401
from app.modules.classroom import teachers  # noqa: E402, F401
from app.modules.classroom import course_seed  # noqa: E402, F401
from app.modules.classroom import favorites  # noqa: E402, F401
from app.modules.classroom import customize  # noqa: E402, F401
from app.modules.classroom import student_enrollment  # noqa: E402, F401
from app.modules.classroom import student_copy  # noqa: E402, F401
from app.modules.classroom import chatbots  # noqa: E402, F401
