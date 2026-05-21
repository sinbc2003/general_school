"""드라이브 자동 폴더 동기화 서비스.

사용자(교사/학생/관리자) 1명의 자동 폴더를 현재 학기 기준으로 멱등 동기화한다.
호출 시점:
  - 사용자 생성/업데이트 (department_id, is_grade_lead, role 변경) — users hook
  - Course owner/co_teacher 배정 — classroom hook
  - CourseStudent 추가 — 학생 수강 등록 hook
  - 학기 생성 직후 일괄 동기화

원칙:
  - 멱등 — (owner_id, auto_kind, semester_id, source_kind, source_id) UNIQUE
  - 누적 — 한번 만들어진 폴더는 자동 삭제 안 함 (자료 정리 보존)
  - 잠금 — 자동 폴더 is_system_locked=True

이름 형식:
  학기 단위:  "{year}학년도 {semester}학기 {label}"
  학년 단위:  "{year}학년도 {grade}학년 ..."  (담임/학급)
  wrapper 내부: 단순 "{과목명}"
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Course,
    CourseStudent,
    CourseTeacher,
    Department,
    Folder,
    Semester,
    SemesterEnrollment,
    User,
)


# ─────────────────────────────────────────────────────────────────────────────
# Auto kind constants
# ─────────────────────────────────────────────────────────────────────────────

KIND_DEPARTMENT = "department"
KIND_GRADE_OFFICE = "grade_office"
KIND_HOMEROOM = "homeroom"
KIND_CLASS_BELONGING = "class_belonging"
KIND_SUBJECT_TEACHING = "subject_teaching"
KIND_SUBJECT_ENROLLED_WRAPPER = "subject_enrolled_wrapper"
KIND_SUBJECT_ENROLLED = "subject_enrolled"
KIND_ADMIN_OFFICE = "admin_office"

# source_kind
SRC_DEPARTMENT = "department"
SRC_GRADE = "grade"
SRC_CLASS = "class"  # source_id = grade*100 + class_no
SRC_COURSE = "course"
SRC_SEMESTER = "semester"


# ─────────────────────────────────────────────────────────────────────────────
# 내부 유틸
# ─────────────────────────────────────────────────────────────────────────────


def _semester_label(sem: Semester) -> str:
    return f"{sem.year}학년도 {sem.semester}학기"


def _grade_label(year: int, grade: int) -> str:
    return f"{year}학년도 {grade}학년"


async def _next_root_sort_order(db: AsyncSession, owner_id: int) -> int:
    """사용자별 root 폴더 다음 sort_order. 누적 (학기 무관)."""
    q = select(func.coalesce(func.max(Folder.sort_order), 0)).where(
        Folder.owner_id == owner_id,
        Folder.parent_id.is_(None),
        Folder.deleted_at.is_(None),
    )
    return int((await db.execute(q)).scalar() or 0) + 1


async def _next_child_sort_order(db: AsyncSession, parent_id: int) -> int:
    """주어진 폴더 자식의 다음 sort_order."""
    q = select(func.coalesce(func.max(Folder.sort_order), 0)).where(
        Folder.parent_id == parent_id,
        Folder.deleted_at.is_(None),
    )
    return int((await db.execute(q)).scalar() or 0) + 1


async def _find_existing(
    db: AsyncSession,
    *,
    owner_id: int,
    auto_kind: str,
    semester_id: int | None,
    source_kind: str | None,
    source_id: int | None,
) -> Folder | None:
    """멱등 조회. NULL 값은 IS NULL로 비교 (PostgreSQL은 UNIQUE에서 NULL을 별개로 취급하므로 코드 단 보호)."""
    q = select(Folder).where(
        Folder.owner_id == owner_id,
        Folder.auto_kind == auto_kind,
    )
    q = q.where(Folder.semester_id == semester_id) if semester_id is not None else q.where(Folder.semester_id.is_(None))
    q = q.where(Folder.source_kind == source_kind) if source_kind is not None else q.where(Folder.source_kind.is_(None))
    q = q.where(Folder.source_id == source_id) if source_id is not None else q.where(Folder.source_id.is_(None))
    return (await db.execute(q.limit(1))).scalar_one_or_none()


async def _ensure_root_folder(
    db: AsyncSession,
    *,
    owner_id: int,
    auto_kind: str,
    name: str,
    semester_id: int | None,
    source_kind: str | None,
    source_id: int | None,
) -> Folder:
    """루트(parent_id=NULL) 자동 폴더 멱등 생성."""
    existing = await _find_existing(
        db, owner_id=owner_id, auto_kind=auto_kind,
        semester_id=semester_id, source_kind=source_kind, source_id=source_id,
    )
    if existing:
        return existing

    order = await _next_root_sort_order(db, owner_id)
    folder = Folder(
        owner_id=owner_id,
        parent_id=None,
        name=name,
        auto_kind=auto_kind,
        semester_id=semester_id,
        source_kind=source_kind,
        source_id=source_id,
        sort_order=order,
        is_system_locked=True,
    )
    db.add(folder)
    await db.flush()
    return folder


async def _ensure_child_folder(
    db: AsyncSession,
    *,
    owner_id: int,
    parent: Folder,
    auto_kind: str,
    name: str,
    semester_id: int | None,
    source_kind: str | None,
    source_id: int | None,
) -> Folder:
    """주어진 parent 자식으로 자동 폴더 멱등 생성."""
    existing = await _find_existing(
        db, owner_id=owner_id, auto_kind=auto_kind,
        semester_id=semester_id, source_kind=source_kind, source_id=source_id,
    )
    if existing:
        return existing

    order = await _next_child_sort_order(db, parent.id)
    folder = Folder(
        owner_id=owner_id,
        parent_id=parent.id,
        name=name,
        auto_kind=auto_kind,
        semester_id=semester_id,
        source_kind=source_kind,
        source_id=source_id,
        sort_order=order,
        is_system_locked=True,
    )
    db.add(folder)
    await db.flush()
    return folder


# ─────────────────────────────────────────────────────────────────────────────
# 종류별 ensure
# ─────────────────────────────────────────────────────────────────────────────


async def ensure_department_folder(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder | None:
    """교사·직원 부서 폴더 (학기별)."""
    if not user.department_id:
        return None
    dept = await db.get(Department, user.department_id)
    if not dept:
        return None
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_DEPARTMENT,
        name=f"{_semester_label(sem)} {dept.name}",
        semester_id=sem.id,
        source_kind=SRC_DEPARTMENT,
        source_id=dept.id,
    )


async def ensure_grade_office_folder(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder | None:
    """학년부장 폴더 (학기별)."""
    if not user.is_grade_lead or not user.lead_grade:
        return None
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_GRADE_OFFICE,
        name=f"{_semester_label(sem)} {user.lead_grade}학년 학년부",
        semester_id=sem.id,
        source_kind=SRC_GRADE,
        source_id=user.lead_grade,
    )


async def ensure_homeroom_folder(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder | None:
    """교사 담임 학급 폴더 (학년 단위 — 학기 prefix 없음).

    SemesterEnrollment.homeroom_class에서 "G-C" 추출.
    """
    enroll = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sem.id,
            SemesterEnrollment.user_id == user.id,
            SemesterEnrollment.homeroom_class.isnot(None),
        ).limit(1)
    )).scalar_one_or_none()
    if not enroll or not enroll.homeroom_class or "-" not in enroll.homeroom_class:
        return None
    try:
        grade_str, class_str = enroll.homeroom_class.split("-")
        grade = int(grade_str)
        class_no = int(class_str)
    except (ValueError, IndexError):
        return None
    source_id = grade * 100 + class_no
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_HOMEROOM,
        # 학년 단위 — 학기 prefix 없음
        name=f"{_grade_label(sem.year, grade)} {class_no}반 담임",
        semester_id=None,
        source_kind=SRC_CLASS,
        source_id=source_id,
    )


async def ensure_class_belonging_folder(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder | None:
    """학생 본인 학급 폴더 (학년 단위 — 학기 prefix 없음)."""
    if user.role != "student":
        return None
    grade = user.grade
    class_no = user.class_number
    if not grade or not class_no:
        return None
    source_id = grade * 100 + class_no
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_CLASS_BELONGING,
        name=f"{_grade_label(sem.year, grade)} {class_no}반",
        semester_id=None,
        source_kind=SRC_CLASS,
        source_id=source_id,
    )


async def ensure_subject_teaching_folder(
    db: AsyncSession, user: User, course: Course, sem: Semester,
) -> Folder | None:
    """교사 강좌 폴더 (학기별, course당 1개)."""
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_SUBJECT_TEACHING,
        name=f"{_semester_label(sem)} {course.subject or course.name}",
        semester_id=sem.id,
        source_kind=SRC_COURSE,
        source_id=course.id,
    )


async def ensure_subject_enrolled_wrapper(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder:
    """학생 수강과목 wrapper 폴더 (학기별)."""
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_SUBJECT_ENROLLED_WRAPPER,
        name=f"{_semester_label(sem)} 수강과목",
        semester_id=sem.id,
        source_kind=SRC_SEMESTER,
        source_id=sem.id,
    )


async def ensure_subject_enrolled_folder(
    db: AsyncSession, user: User, course: Course, wrapper: Folder,
) -> Folder:
    """학생 수강 강좌 폴더 (wrapper 안)."""
    return await _ensure_child_folder(
        db,
        owner_id=user.id,
        parent=wrapper,
        auto_kind=KIND_SUBJECT_ENROLLED,
        name=course.subject or course.name,
        semester_id=course.semester_id,
        source_kind=SRC_COURSE,
        source_id=course.id,
    )


async def ensure_admin_office_folder(
    db: AsyncSession, user: User, sem: Semester,
) -> Folder | None:
    """관리자(super_admin/designated_admin) 폴더 (학기별)."""
    if user.role not in ("super_admin", "designated_admin"):
        return None
    return await _ensure_root_folder(
        db,
        owner_id=user.id,
        auto_kind=KIND_ADMIN_OFFICE,
        name=f"{_semester_label(sem)} 관리자",
        semester_id=sem.id,
        source_kind=SRC_SEMESTER,
        source_id=sem.id,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 통합 동기화 (사용자 1명 / 학기 1개)
# ─────────────────────────────────────────────────────────────────────────────


async def _current_semester(db: AsyncSession) -> Semester | None:
    q = select(Semester).where(Semester.is_current == True).limit(1)  # noqa: E712
    return (await db.execute(q)).scalar_one_or_none()


async def sync_user_folders(
    db: AsyncSession,
    user: User | int,
    sem: Semester | int | None = None,
) -> dict[str, Any]:
    """사용자 1명 자동 폴더 동기화. 멱등.

    Args:
        user: User 객체 또는 user_id
        sem: Semester 객체 또는 semester_id. None이면 is_current=True 학기.

    Returns:
        {"created": [folder_dict, ...], "skipped": N}
    """
    if isinstance(user, int):
        user_obj = await db.get(User, user)
        if not user_obj:
            return {"created": [], "skipped": 0, "error": "user not found"}
        user = user_obj

    if sem is None:
        sem = await _current_semester(db)
    elif isinstance(sem, int):
        sem = await db.get(Semester, sem)
    if not sem:
        return {"created": [], "skipped": 0, "error": "no active semester"}

    created: list[Folder] = []
    before_ids: set[int] = set()

    async def _track(f: Folder | None) -> Folder | None:
        if f and f.id not in before_ids:
            before_ids.add(f.id)
            created.append(f)
        return f

    role = user.role

    # 1. 관리자
    if role in ("super_admin", "designated_admin"):
        await _track(await ensure_admin_office_folder(db, user, sem))

    # 2. 교사/직원 — 부서 + 학년부 + 담임 + 가르치는 강좌
    if role in ("teacher", "staff", "super_admin", "designated_admin"):
        await _track(await ensure_department_folder(db, user, sem))
        await _track(await ensure_grade_office_folder(db, user, sem))
        await _track(await ensure_homeroom_folder(db, user, sem))

        # 가르치는 강좌 (owner + co_teacher)
        owned = (await db.execute(
            select(Course).where(
                Course.semester_id == sem.id,
                Course.teacher_id == user.id,
                Course.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        co_courses = (await db.execute(
            select(Course).join(
                CourseTeacher, CourseTeacher.course_id == Course.id,
            ).where(
                Course.semester_id == sem.id,
                CourseTeacher.user_id == user.id,
                CourseTeacher.role == "co_teacher",
                Course.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        seen_course_ids: set[int] = set()
        for course in list(owned) + list(co_courses):
            if course.id in seen_course_ids:
                continue
            seen_course_ids.add(course.id)
            await _track(await ensure_subject_teaching_folder(db, user, course, sem))

    # 3. 학생 — 학급 + 수강과목 wrapper + 안에 개별 과목
    if role == "student":
        await _track(await ensure_class_belonging_folder(db, user, sem))

        # 수강 강좌가 1개 이상이면 wrapper 생성
        enrolled = (await db.execute(
            select(Course).join(
                CourseStudent, CourseStudent.course_id == Course.id,
            ).where(
                Course.semester_id == sem.id,
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
                Course.is_active == True,  # noqa: E712
            )
        )).scalars().all()

        if enrolled:
            wrapper = await ensure_subject_enrolled_wrapper(db, user, sem)
            await _track(wrapper)
            for course in enrolled:
                await _track(
                    await ensure_subject_enrolled_folder(db, user, course, wrapper)
                )

    await db.flush()
    return {
        "created_count": len(created),
        "created": [
            {
                "id": f.id, "name": f.name, "auto_kind": f.auto_kind,
                "parent_id": f.parent_id, "sort_order": f.sort_order,
            }
            for f in created
        ],
    }


async def sync_all_users(
    db: AsyncSession, semester_id: int | None = None,
) -> dict[str, Any]:
    """학기 생성/마이그레이션 직후 일괄 동기화.

    is_current=True 학기 또는 명시 학기에서 active 사용자 전원 자동 폴더 동기화.
    """
    if semester_id is None:
        sem = await _current_semester(db)
    else:
        sem = await db.get(Semester, semester_id)
    if not sem:
        return {"users_processed": 0, "folders_created": 0, "error": "no semester"}

    users = (await db.execute(
        select(User).where(
            User.status != "disabled",
            User.lifecycle_status == "active",
        )
    )).scalars().all()

    total_created = 0
    for u in users:
        r = await sync_user_folders(db, u, sem)
        total_created += r.get("created_count", 0)

    return {
        "users_processed": len(users),
        "folders_created": total_created,
        "semester": f"{sem.year}-{sem.semester}",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 단일 source 핀포인트 동기화 (hook용)
# ─────────────────────────────────────────────────────────────────────────────


async def on_course_teacher_assigned(
    db: AsyncSession, *, course_id: int, user_id: int,
) -> Folder | None:
    """Course owner 또는 co_teacher 배정 직후 hook.

    해당 강좌에 대한 subject_teaching 폴더 1개 생성.
    """
    course = await db.get(Course, course_id)
    if not course:
        return None
    user = await db.get(User, user_id)
    if not user:
        return None
    sem = await db.get(Semester, course.semester_id)
    if not sem:
        return None
    return await ensure_subject_teaching_folder(db, user, course, sem)


async def on_course_student_enrolled(
    db: AsyncSession, *, course_id: int, student_id: int,
) -> Folder | None:
    """CourseStudent 추가 직후 hook.

    학생 수강과목 wrapper + 해당 강좌 폴더 생성.
    """
    course = await db.get(Course, course_id)
    if not course:
        return None
    student = await db.get(User, student_id)
    if not student:
        return None
    sem = await db.get(Semester, course.semester_id)
    if not sem:
        return None
    wrapper = await ensure_subject_enrolled_wrapper(db, student, sem)
    return await ensure_subject_enrolled_folder(db, student, course, wrapper)
