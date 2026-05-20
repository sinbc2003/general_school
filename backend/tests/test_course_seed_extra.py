"""course_seed 추가 시나리오 — disabled lead, dual grade leads, dry-run preview.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.models import Course, Semester, SemesterEnrollment, CourseTeacher, User


@pytest.mark.asyncio
async def test_seed_skips_disabled_grade_lead(
    app_client, db_session, super_admin, auth_headers,
):
    """is_grade_lead이지만 status=disabled면 강좌 생성 안 됨."""
    from tests.conftest import _create_user

    sem = Semester(
        name="S", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    disabled_lead = await _create_user(
        db_session, email="dis_lead@test.local", name="Disabled Lead", role="teacher",
    )
    disabled_lead.is_grade_lead = True
    disabled_lead.lead_grade = 1
    disabled_lead.status = "disabled"
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["total_created"] == 0


@pytest.mark.asyncio
async def test_seed_dual_grade_leads_creates_two_courses(
    app_client, db_session, super_admin, auth_headers,
):
    """2명의 다른 학년 부장 → 2개 강좌."""
    from tests.conftest import _create_user

    sem = Semester(
        name="S", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    for g in (1, 2):
        lead = await _create_user(
            db_session, email=f"lead_g{g}@test.local",
            name=f"Lead {g}", role="teacher",
        )
        lead.is_grade_lead = True
        lead.lead_grade = g
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False},
        headers=auth_headers(super_admin),
    )
    assert r.json()["total_created"] == 2

    # 각 학년 강좌가 존재
    courses = (await db_session.execute(
        select(Course).where(
            Course.semester_id == sem.id,
            Course.course_type == "grade_office",
        )
    )).scalars().all()
    grades = {c.grade_level for c in courses}
    assert grades == {1, 2}


@pytest.mark.asyncio
async def test_seed_grade_office_adds_homeroom_co_teachers(
    app_client, db_session, super_admin, auth_headers,
):
    """같은 학년 담임이 학년부 강좌의 co_teacher로 자동 추가."""
    from tests.conftest import _create_user

    sem = Semester(
        name="S", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    lead = await _create_user(
        db_session, email="ll@test.local", name="Lead", role="teacher",
    )
    lead.is_grade_lead = True
    lead.lead_grade = 3

    homeroom_teacher = await _create_user(
        db_session, email="hr@test.local", name="HR Teacher", role="teacher",
    )
    db_session.add(SemesterEnrollment(
        semester_id=sem.id, user_id=homeroom_teacher.id,
        role="teacher", homeroom_class="3-1",
    ))
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False},
        headers=auth_headers(super_admin),
    )
    assert r.json()["total_created"] == 1

    course = (await db_session.execute(
        select(Course).where(
            Course.semester_id == sem.id,
            Course.course_type == "grade_office",
            Course.grade_level == 3,
        )
    )).scalar_one_or_none()
    assert course is not None

    # homeroom_teacher가 co_teacher로 추가됐는지
    ct = (await db_session.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == course.id,
            CourseTeacher.user_id == homeroom_teacher.id,
        )
    )).scalar_one_or_none()
    assert ct is not None
    assert ct.role == "co_teacher"


@pytest.mark.asyncio
async def test_seed_dry_run_returns_preview_without_db_changes(
    app_client, db_session, super_admin, auth_headers,
):
    """dry_run=True → DB 변경 없이 preview만."""
    from tests.conftest import _create_user

    sem = Semester(
        name="S", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    lead = await _create_user(
        db_session, email="dry@test.local", name="Dry Lead", role="teacher",
    )
    lead.is_grade_lead = True
    lead.lead_grade = 1
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "dry_run": True},
        headers=auth_headers(super_admin),
    )
    assert r.json()["dry_run"] is True
    # preview에 정보 있음
    preview = r.json()["types"]["grade_office"]["preview"]
    assert len(preview) == 1
    assert preview[0]["status"] == "create"
    assert preview[0]["owner"] == "Dry Lead"

    # DB에 강좌 없음
    courses = (await db_session.execute(
        select(Course).where(Course.semester_id == sem.id)
    )).scalars().all()
    assert len(courses) == 0


@pytest.mark.asyncio
async def test_seed_nonexistent_semester_returns_empty(
    app_client, super_admin, auth_headers,
):
    """존재하지 않는 학기 id → 빈 결과 (or 200, 의도 명확화)."""
    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": 999999, "grade_office": True, "class_homeroom": True},
        headers=auth_headers(super_admin),
    )
    # 학기 없으면 서비스가 그냥 빈 결과 반환 (또는 errors에 메시지)
    assert r.status_code == 200
    assert r.json()["total_created"] == 0
