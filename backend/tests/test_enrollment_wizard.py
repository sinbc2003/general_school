"""학생 수강과목 마법사 API 테스트.

검증:
  - GET /api/me/enrollment/status — 학생 본인만 접근
  - 비학생 호출 시 403
  - 선택과목 등록 (subjects) — 학급 단위 강좌 거부
  - 본인 수강 강좌 외 다른 학생 수강 시도 차단
  - 마법사 완료 시 onboarded=True
  - CSV import — 학번/강좌 매칭, max_rows 차단, admin 가드
"""

from __future__ import annotations

import io
from datetime import date
import pytest
from sqlalchemy import select

from app.models import (
    Course, CourseStudent, Semester, SemesterEnrollment, User,
)


async def _make_semester(db_session, is_current=True):
    sem = Semester(
        year=2026, semester=1, name="2026-1",
        start_date=date(2026, 3, 1), end_date=date(2026, 8, 31),
        is_current=is_current,
    )
    db_session.add(sem)
    await db_session.commit()
    return sem


async def _make_course(db_session, semester_id, teacher_id, subject, class_name=None, grade_level=None):
    c = Course(
        semester_id=semester_id, teacher_id=teacher_id,
        subject=subject, class_name=class_name,
        name=f"{class_name or subject}",
        course_type="subject", grade_level=grade_level,
    )
    db_session.add(c)
    await db_session.commit()
    return c


@pytest.mark.security
@pytest.mark.asyncio
async def test_enrollment_status_for_student(
    app_client, db_session, student_user, auth_headers,
):
    await _make_semester(db_session)
    r = await app_client.get(
        "/api/me/enrollment/status",
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["onboarded"] is False
    assert data["grade"] == 2
    assert data["class_number"] == 3


@pytest.mark.security
@pytest.mark.asyncio
async def test_enrollment_status_teacher_blocked(
    app_client, db_session, teacher_user, auth_headers,
):
    """비학생(교사)이 학생 마법사 endpoint 호출 시 403."""
    await _make_semester(db_session)
    r = await app_client.get(
        "/api/me/enrollment/status",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_available_courses_filters_by_grade(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    sem = await _make_semester(db_session)
    # student grade=2. 후보 강좌:
    elective_2 = await _make_course(
        db_session, sem.id, teacher_user.id, "수학II", grade_level=2,
    )
    elective_3 = await _make_course(
        db_session, sem.id, teacher_user.id, "물리II", grade_level=3,
    )
    elective_any = await _make_course(
        db_session, sem.id, teacher_user.id, "한국사", grade_level=None,
    )

    r = await app_client.get(
        "/api/me/enrollment/available-courses",
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    cand_ids = {c["id"] for c in r.json()["candidates"]}
    assert elective_2.id in cand_ids
    assert elective_3.id not in cand_ids  # 다른 학년
    assert elective_any.id in cand_ids


@pytest.mark.security
@pytest.mark.asyncio
async def test_enroll_class_unit_course_rejected(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """학급 단위 강좌(class_name 있음)는 학생 본인이 등록 불가 (자동 등록만)."""
    sem = await _make_semester(db_session)
    class_course = await _make_course(
        db_session, sem.id, teacher_user.id, "수학I", class_name="2-3", grade_level=2,
    )
    r = await app_client.post(
        "/api/me/enrollment/subjects",
        json={"course_ids": [class_course.id]},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    data = r.json()
    # added=0, errors에 "학급 단위" 포함
    assert data["added"] == 0
    assert any("학급 단위" in e for e in data["errors"])


@pytest.mark.asyncio
async def test_enroll_subject_and_complete_wizard(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    sem = await _make_semester(db_session)
    elective = await _make_course(
        db_session, sem.id, teacher_user.id, "수학II", grade_level=2,
    )

    # 선택과목 등록
    r = await app_client.post(
        "/api/me/enrollment/subjects",
        json={"course_ids": [elective.id]},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    assert r.json()["added"] == 1

    # 마법사 완료
    r = await app_client.post(
        "/api/me/enrollment/complete",
        json={},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    assert r.json()["onboarded"] is True

    # status 재확인
    r = await app_client.get(
        "/api/me/enrollment/status",
        headers=auth_headers(student_user),
    )
    assert r.json()["onboarded"] is True
    assert r.json()["enrolled_courses_count"] == 1


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_import_admin_only(
    app_client, db_session, teacher_user, super_admin, auth_headers,
):
    """CSV 일괄 등록은 super_admin/designated_admin만."""
    await _make_semester(db_session)
    csv = "student_number,course_id,subject,grade_level\n10101,,수학I,1\n".encode("utf-8")

    # 교사 호출 → 403
    r = await app_client.post(
        "/api/classroom/_enrollment/import",
        files={"file": ("a.csv", io.BytesIO(csv), "text/csv")},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code in (403, 401)

    # super_admin 호출 → 통과 (학생 없으면 errors에 포함, 200)
    r = await app_client.post(
        "/api/classroom/_enrollment/import",
        files={"file": ("a.csv", io.BytesIO(csv), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_import_rejects_too_many_rows(
    app_client, db_session, super_admin, auth_headers,
):
    """CSV row 5000 초과 시 차단 (DoS 방어)."""
    await _make_semester(db_session)
    header = "student_number,course_id,subject,grade_level\n"
    body = "\n".join(f"{10000+i},,수학I,1" for i in range(5500))
    csv = (header + body).encode("utf-8")

    r = await app_client.post(
        "/api/classroom/_enrollment/import",
        files={"file": ("big.csv", io.BytesIO(csv), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    errs = r.json().get("errors", [])
    assert any("5000" in e or "초과" in e for e in errs)
