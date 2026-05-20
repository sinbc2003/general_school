"""클래스룸 확장 (공동교사, 즐겨찾기, 카드 커스터마이징, 자동 강좌 생성) 통합 테스트."""

import pytest
from datetime import date
from sqlalchemy import select

from app.models import (
    Course, CourseTeacher, UserFavoriteCourse, Semester, SemesterEnrollment, User,
)


async def _make_semester_and_course(db_session, teacher):
    """공통 fixture — 학기 + 강좌 1개."""
    sem = Semester(
        name="2026-1", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()
    course = Course(
        semester_id=sem.id,
        teacher_id=teacher.id,
        subject="수학",
        class_name="2-1",
        name="2-1 수학",
        is_active=True,
        course_type="subject",
    )
    db_session.add(course)
    await db_session.commit()
    await db_session.refresh(course)
    return sem, course


# ── 공동교사 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_co_teacher_by_owner(
    app_client, db_session, teacher_user, super_admin, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    from tests.conftest import _create_user
    co = await _create_user(
        db_session, email="co@test.local", name="Co Teacher", role="teacher",
    )
    await db_session.commit()

    r = await app_client.post(
        f"/api/classroom/courses/{course.id}/teachers",
        json={"user_id": co.id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["role"] == "co_teacher"


@pytest.mark.asyncio
async def test_non_owner_cannot_add_co_teacher(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    # student가 본인을 co_teacher로 추가 시도 → 403
    r = await app_client.post(
        f"/api/classroom/courses/{course.id}/teachers",
        json={"user_id": student_user.id},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_cannot_add_student_as_co_teacher(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    r = await app_client.post(
        f"/api/classroom/courses/{course.id}/teachers",
        json={"user_id": student_user.id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_list_course_teachers_includes_owner(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    r = await app_client.get(
        f"/api/classroom/courses/{course.id}/teachers",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    owners = [it for it in items if it["role"] == "owner"]
    assert len(owners) == 1
    assert owners[0]["user_id"] == teacher_user.id


@pytest.mark.asyncio
async def test_remove_co_teacher(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    from tests.conftest import _create_user
    co = await _create_user(
        db_session, email="co2@test.local", name="Co2", role="teacher",
    )
    db_session.add(CourseTeacher(course_id=course.id, user_id=co.id, role="co_teacher"))
    await db_session.commit()

    r = await app_client.delete(
        f"/api/classroom/courses/{course.id}/teachers/{co.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200


# ── 즐겨찾기 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_favorite_course_toggle(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    # 즐겨찾기 추가
    r = await app_client.post(
        f"/api/classroom/courses/{course.id}/favorite",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    # 목록 확인
    r = await app_client.get(
        "/api/classroom/favorites", headers=auth_headers(teacher_user),
    )
    assert course.id in r.json()["course_ids"]

    # 제거
    r = await app_client.delete(
        f"/api/classroom/courses/{course.id}/favorite",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    r = await app_client.get(
        "/api/classroom/favorites", headers=auth_headers(teacher_user),
    )
    assert course.id not in r.json()["course_ids"]


@pytest.mark.asyncio
async def test_favorite_duplicate_idempotent(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    await app_client.post(
        f"/api/classroom/courses/{course.id}/favorite",
        headers=auth_headers(teacher_user),
    )
    # 두 번째 호출도 200 OK (중복 무시)
    r = await app_client.post(
        f"/api/classroom/courses/{course.id}/favorite",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    # DB row는 1개만
    cnt = (await db_session.execute(
        select(UserFavoriteCourse).where(
            UserFavoriteCourse.user_id == teacher_user.id,
            UserFavoriteCourse.course_id == course.id,
        )
    )).all()
    assert len(cnt) == 1


# ── 카드 커스터마이징 ────────────────────────────────────


@pytest.mark.asyncio
async def test_customize_banner_color(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    r = await app_client.patch(
        f"/api/classroom/courses/{course.id}/customize",
        json={"banner_color": "#33B679"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["banner_color"] == "#33B679"


@pytest.mark.asyncio
async def test_customize_invalid_color_format_rejected(
    app_client, db_session, teacher_user, auth_headers,
):
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    r = await app_client.patch(
        f"/api/classroom/courses/{course.id}/customize",
        json={"banner_color": "red"},  # # 없음
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 422  # pydantic regex 실패


@pytest.mark.asyncio
async def test_customize_viewable_by_admin_only(
    app_client, db_session, teacher_user, super_admin, auth_headers,
):
    """viewable_by 변경은 admin만."""
    sem, course = await _make_semester_and_course(db_session, teacher_user)

    # owner인 teacher_user가 viewable_by 변경 시도 → 403
    r = await app_client.patch(
        f"/api/classroom/courses/{course.id}/customize",
        json={"viewable_by": "assigned_only"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403

    # super_admin은 가능
    r = await app_client.patch(
        f"/api/classroom/courses/{course.id}/customize",
        json={"viewable_by": "assigned_only"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200


# ── 학기 자동 강좌 생성 ────────────────────────────────


@pytest.mark.asyncio
async def test_seed_grade_office_course(
    app_client, db_session, super_admin, auth_headers,
):
    """학년부장이 있으면 학년부 강좌 자동 생성."""
    from tests.conftest import _create_user

    sem = Semester(name="2026-1", year=2026, semester=1, is_current=True, start_date=date(2026, 3, 1), end_date=date(2026, 7, 31))
    db_session.add(sem)
    await db_session.flush()

    lead = await _create_user(
        db_session, email="lead@test.local", name="Grade Lead", role="teacher",
    )
    lead.is_grade_lead = True
    lead.lead_grade = 1
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={
            "semester_id": sem.id,
            "grade_office": True,
            "class_homeroom": False,
            "dry_run": False,
        },
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total_created"] == 1

    # DB 확인
    courses = (await db_session.execute(
        select(Course).where(
            Course.semester_id == sem.id,
            Course.course_type == "grade_office",
        )
    )).scalars().all()
    assert len(courses) == 1
    assert courses[0].teacher_id == lead.id
    assert courses[0].grade_level == 1


@pytest.mark.asyncio
async def test_seed_idempotent_skips_existing(
    app_client, db_session, super_admin, auth_headers,
):
    """이미 있는 학년부 강좌는 skip."""
    from tests.conftest import _create_user

    sem = Semester(name="2026-1", year=2026, semester=1, is_current=True, start_date=date(2026, 3, 1), end_date=date(2026, 7, 31))
    db_session.add(sem)
    await db_session.flush()

    lead = await _create_user(
        db_session, email="lead2@test.local", name="L2", role="teacher",
    )
    lead.is_grade_lead = True
    lead.lead_grade = 2
    await db_session.commit()

    # 첫 호출 — 생성
    r1 = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False},
        headers=auth_headers(super_admin),
    )
    assert r1.json()["total_created"] == 1

    # 두 번째 — skip
    r2 = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False},
        headers=auth_headers(super_admin),
    )
    assert r2.json()["total_created"] == 0
    assert r2.json()["total_skipped"] == 1


@pytest.mark.asyncio
async def test_seed_dry_run_does_not_create(
    app_client, db_session, super_admin, auth_headers,
):
    from tests.conftest import _create_user

    sem = Semester(name="2026-1", year=2026, semester=1, is_current=True, start_date=date(2026, 3, 1), end_date=date(2026, 7, 31))
    db_session.add(sem)
    await db_session.flush()

    lead = await _create_user(
        db_session, email="lead3@test.local", name="L3", role="teacher",
    )
    lead.is_grade_lead = True
    lead.lead_grade = 3
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": True, "class_homeroom": False, "dry_run": True},
        headers=auth_headers(super_admin),
    )
    assert r.json()["dry_run"] is True

    # DB에 생성 안 됨
    courses = (await db_session.execute(
        select(Course).where(Course.semester_id == sem.id)
    )).scalars().all()
    assert len(courses) == 0
