"""folder_seed 서비스 테스트 — 자동 폴더 생성 + 멱등성.

검증:
  - 교사 부서 폴더 / 가르치는 강좌 폴더 / 담임 폴더
  - 학생 학급 폴더 / 수강과목 wrapper + 안에 강좌 폴더
  - 관리자 폴더
  - 멱등성 — 같은 source 두 번 호출해도 추가 안 됨
  - sort_order — 사용자별 누적
  - 학기 전환 시 새 학기 폴더 추가 (학기 단위), 학년 단위는 skip
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models import (
    Course, CourseStudent, CourseTeacher, Department, Folder,
    Semester, SemesterEnrollment, User,
)
from app.services.folder_seed import (
    sync_user_folders,
    on_course_teacher_assigned,
    on_course_student_enrolled,
    KIND_DEPARTMENT, KIND_HOMEROOM, KIND_CLASS_BELONGING,
    KIND_SUBJECT_TEACHING, KIND_SUBJECT_ENROLLED_WRAPPER, KIND_SUBJECT_ENROLLED,
    KIND_ADMIN_OFFICE,
)


async def _make_semester(db_session, year=2026, semester=1, is_current=True):
    sem = Semester(
        year=year, semester=semester, name=f"{year}-{semester}",
        start_date=date(year, 3, 1), end_date=date(year, 8, 31),
        is_current=is_current,
    )
    db_session.add(sem)
    await db_session.commit()
    return sem


async def _get_folders(db_session, user_id):
    q = select(Folder).where(Folder.owner_id == user_id, Folder.deleted_at.is_(None))
    return (await db_session.execute(q)).scalars().all()


@pytest.mark.asyncio
async def test_teacher_department_folder_created(
    db_session, teacher_user,
):
    sem = await _make_semester(db_session)
    dept = Department(name="교무부")
    db_session.add(dept)
    await db_session.commit()
    teacher_user.department_id = dept.id
    await db_session.commit()

    r = await sync_user_folders(db_session, teacher_user, sem)
    folders = await _get_folders(db_session, teacher_user.id)
    kinds = {f.auto_kind for f in folders}
    assert KIND_DEPARTMENT in kinds
    dept_folder = next(f for f in folders if f.auto_kind == KIND_DEPARTMENT)
    assert "2026학년도 1학기 교무부" in dept_folder.name


@pytest.mark.asyncio
async def test_sync_idempotent(db_session, teacher_user):
    sem = await _make_semester(db_session)
    dept = Department(name="학생부")
    db_session.add(dept)
    await db_session.commit()
    teacher_user.department_id = dept.id
    await db_session.commit()

    # 두 번 호출
    await sync_user_folders(db_session, teacher_user, sem)
    await sync_user_folders(db_session, teacher_user, sem)

    folders = await _get_folders(db_session, teacher_user.id)
    dept_folders = [f for f in folders if f.auto_kind == KIND_DEPARTMENT]
    assert len(dept_folders) == 1  # 중복 없음


@pytest.mark.asyncio
async def test_student_class_folder_created(db_session, student_user):
    sem = await _make_semester(db_session)
    # student_user grade=2 class_number=3 (fixture)
    await sync_user_folders(db_session, student_user, sem)
    folders = await _get_folders(db_session, student_user.id)
    class_folder = next(
        (f for f in folders if f.auto_kind == KIND_CLASS_BELONGING), None,
    )
    assert class_folder is not None
    assert "2026학년도 2학년 3반" == class_folder.name
    # 학년 단위 → semester_id None
    assert class_folder.semester_id is None
    # source_id = grade*100 + class
    assert class_folder.source_id == 203


@pytest.mark.asyncio
async def test_student_enrolled_subjects_wrapper(
    db_session, teacher_user, student_user,
):
    sem = await _make_semester(db_session)
    c1 = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="수학II", class_name=None, name="수학II",
        course_type="subject", grade_level=2,
    )
    c2 = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="물리II", class_name=None, name="물리II",
        course_type="subject", grade_level=2,
    )
    db_session.add_all([c1, c2])
    await db_session.commit()
    db_session.add_all([
        CourseStudent(course_id=c1.id, student_id=student_user.id),
        CourseStudent(course_id=c2.id, student_id=student_user.id),
    ])
    await db_session.commit()

    await sync_user_folders(db_session, student_user, sem)
    folders = await _get_folders(db_session, student_user.id)

    wrappers = [f for f in folders if f.auto_kind == KIND_SUBJECT_ENROLLED_WRAPPER]
    assert len(wrappers) == 1
    wrapper = wrappers[0]
    assert wrapper.parent_id is None

    children = [
        f for f in folders
        if f.auto_kind == KIND_SUBJECT_ENROLLED and f.parent_id == wrapper.id
    ]
    assert len(children) == 2
    names = {f.name for f in children}
    assert {"수학II", "물리II"} == names


@pytest.mark.asyncio
async def test_sort_order_accumulates_across_semesters(
    db_session, teacher_user,
):
    """1학기 → 2학기 전환 시 새 폴더 sort_order MAX+1."""
    sem1 = await _make_semester(db_session, year=2026, semester=1, is_current=True)
    dept = Department(name="과학과")
    db_session.add(dept)
    await db_session.commit()
    teacher_user.department_id = dept.id
    await db_session.commit()

    await sync_user_folders(db_session, teacher_user, sem1)
    folders1 = await _get_folders(db_session, teacher_user.id)
    max_order_1 = max(f.sort_order for f in folders1) if folders1 else 0

    # 2학기로 전환
    sem1.is_current = False
    sem2 = await _make_semester(db_session, year=2026, semester=2, is_current=True)
    await sync_user_folders(db_session, teacher_user, sem2)
    folders2 = await _get_folders(db_session, teacher_user.id)
    # 1학기 폴더 + 2학기 폴더 모두 있어야 (누적)
    dept_folders = [f for f in folders2 if f.auto_kind == KIND_DEPARTMENT]
    assert len(dept_folders) == 2  # 1학기 + 2학기 두 개
    # 2학기 폴더의 sort_order > 1학기 max
    sem2_folder = next(f for f in dept_folders if f.semester_id == sem2.id)
    assert sem2_folder.sort_order > max_order_1


@pytest.mark.asyncio
async def test_admin_office_folder_for_super_admin(
    db_session, super_admin,
):
    sem = await _make_semester(db_session)
    await sync_user_folders(db_session, super_admin, sem)
    folders = await _get_folders(db_session, super_admin.id)
    admin_folders = [f for f in folders if f.auto_kind == KIND_ADMIN_OFFICE]
    assert len(admin_folders) == 1
    assert "관리자" in admin_folders[0].name


@pytest.mark.asyncio
async def test_on_course_teacher_assigned_hook(
    db_session, teacher_user,
):
    sem = await _make_semester(db_session)
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="수학I", class_name="1-1", name="1-1 수학",
        course_type="subject", grade_level=1,
    )
    db_session.add(c)
    await db_session.commit()

    folder = await on_course_teacher_assigned(
        db_session, course_id=c.id, user_id=teacher_user.id,
    )
    assert folder is not None
    assert folder.auto_kind == KIND_SUBJECT_TEACHING
    assert folder.source_id == c.id


@pytest.mark.asyncio
async def test_on_course_student_enrolled_hook(
    db_session, teacher_user, student_user,
):
    sem = await _make_semester(db_session)
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="화학I", class_name=None, name="화학I",
        course_type="subject", grade_level=2,
    )
    db_session.add(c)
    await db_session.commit()
    db_session.add(CourseStudent(course_id=c.id, student_id=student_user.id))
    await db_session.commit()

    folder = await on_course_student_enrolled(
        db_session, course_id=c.id, student_id=student_user.id,
    )
    assert folder is not None
    assert folder.auto_kind == KIND_SUBJECT_ENROLLED
    # parent는 wrapper
    assert folder.parent_id is not None
    wrapper = await db_session.get(Folder, folder.parent_id)
    assert wrapper.auto_kind == KIND_SUBJECT_ENROLLED_WRAPPER
