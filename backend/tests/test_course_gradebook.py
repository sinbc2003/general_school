"""강좌 성적표(gradebook) 회귀 테스트.

검증:
  - 과제(CoursePostSubmission.score) + 문제세트(StudentProblemAttempt) 집계
  - 교사/admin: 전원 행 / 학생: 본인 행만 (접근제어)
  - 비-멤버: 403
"""

from datetime import date

import pytest
import pytest_asyncio

from app.models.archive import Problem
from app.models.classroom import Course, CoursePost, CoursePostSubmission, CourseStudent
from app.models.courseware import CourseProblemSet, StudentProblemAttempt
from app.models.timetable import Semester
from tests.conftest import _create_user


@pytest_asyncio.fixture
async def gb_setup(db_session, teacher_user):
    sem = Semester(
        year=2026, semester=1, name="2026-1", is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 20),
    )
    db_session.add(sem)
    await db_session.flush()
    course = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="수학", class_name="2-3", name="2-3 수학",
    )
    db_session.add(course)
    await db_session.flush()

    s1 = await _create_user(
        db_session, email="gb_s1@test.local", name="학생1",
        role="student", grade=2, class_number=3, student_number=1,
    )
    s2 = await _create_user(
        db_session, email="gb_s2@test.local", name="학생2",
        role="student", grade=2, class_number=3, student_number=2,
    )
    db_session.add_all([
        CourseStudent(course_id=course.id, student_id=s1.id, status="active"),
        CourseStudent(course_id=course.id, student_id=s2.id, status="active"),
    ])

    # 과제 + s1 채점 제출(18/20)
    post = CoursePost(
        course_id=course.id, author_id=teacher_user.id,
        post_type="assignment_ref", title="1차 과제", content="과제 안내", max_score=20,
    )
    db_session.add(post)
    await db_session.flush()
    db_session.add(CoursePostSubmission(
        post_id=post.id, student_id=s1.id, status="returned", score=18,
    ))

    # 문제세트(2문제) + s1 attempts (1 정답 1 오답 → 50%)
    p1 = Problem(subject="수학", difficulty="중", question_type="객관식", content="문1")
    p2 = Problem(subject="수학", difficulty="중", question_type="객관식", content="문2")
    db_session.add_all([p1, p2])
    await db_session.flush()
    pset = CourseProblemSet(
        course_id=course.id, title="연습문제", status="published",
        problem_ids=[p1.id, p2.id],
    )
    db_session.add(pset)
    await db_session.flush()
    db_session.add_all([
        StudentProblemAttempt(
            problem_set_id=pset.id, problem_id=p1.id, student_id=s1.id,
            attempt_number=1, is_correct=True, auto_score=1.0,
        ),
        StudentProblemAttempt(
            problem_set_id=pset.id, problem_id=p2.id, student_id=s1.id,
            attempt_number=1, is_correct=False, auto_score=0.0,
        ),
    ])
    await db_session.commit()  # 403-first 안전 + 요청 가시성
    return {"course": course, "s1": s1, "s2": s2}


@pytest.mark.asyncio
async def test_teacher_sees_all_rows_with_scores(app_client, auth_headers, teacher_user, gb_setup):
    r = await app_client.get(
        f"/api/classroom/courses/{gb_setup['course'].id}/grades",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "teacher"
    assert len(data["rows"]) == 2  # 두 학생 모두
    assert len(data["columns"]) == 2  # 과제 1 + 문제세트 1

    akey = next(c["key"] for c in data["columns"] if c["kind"] == "assignment")
    pkey = next(c["key"] for c in data["columns"] if c["kind"] == "problemset")

    s1row = next(row for row in data["rows"] if row["student_id"] == gb_setup["s1"].id)
    assert s1row["cells"][akey]["score"] == 18
    assert s1row["cells"][pkey]["percent"] == 50  # 1/2 정답

    s2row = next(row for row in data["rows"] if row["student_id"] == gb_setup["s2"].id)
    assert s2row["cells"] == {}  # 제출·풀이 없음


@pytest.mark.asyncio
async def test_student_sees_only_self(app_client, auth_headers, gb_setup):
    r = await app_client.get(
        f"/api/classroom/courses/{gb_setup['course'].id}/grades",
        headers=auth_headers(gb_setup["s1"]),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["role"] == "student"
    assert len(data["rows"]) == 1
    assert data["rows"][0]["student_id"] == gb_setup["s1"].id


@pytest.mark.asyncio
async def test_non_member_forbidden(app_client, auth_headers, db_session, gb_setup):
    outsider = await _create_user(
        db_session, email="gb_out@test.local", name="외부교사", role="teacher",
    )
    await db_session.commit()
    r = await app_client.get(
        f"/api/classroom/courses/{gb_setup['course'].id}/grades",
        headers=auth_headers(outsider),
    )
    assert r.status_code == 403
