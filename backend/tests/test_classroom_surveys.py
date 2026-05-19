"""클래스룸 설문지 보안·권한 테스트.

회귀 시나리오:
1. 학생은 다른 사람 설문 결과 조회 403
2. 학생 비멤버는 course_members 모드 응답 403
3. 강좌 학생은 응답 OK, 중복 응답 차단 (allow_multiple=False + 실명)
4. 익명 모드면 respondent_id=null로 저장 (개인정보 보호)
5. draft → active 전환 후 응답 받기 가능
6. 작성자가 아니면 질문 추가/편집/삭제 403
7. 필수 질문 미응답 시 400
"""

from datetime import date

import pytest
import pytest_asyncio

from app.models.classroom import Course, CourseStudent
from app.models.classroom_surveys import (
    Survey, SurveyAnswer, SurveyQuestion, SurveyResponse,
)
from app.models.timetable import Semester


pytestmark = pytest.mark.security


# ── fixtures ───────────────────────────────────────────────


@pytest_asyncio.fixture
async def semester(db_session):
    s = Semester(
        year=2026, semester=1, name="2026-1", is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 20),
    )
    db_session.add(s)
    await db_session.flush()
    return s


@pytest_asyncio.fixture
async def other_student(db_session, seed_perms):
    from tests.conftest import _create_user
    return await _create_user(
        db_session, email="other@test.local", name="Other",
        role="student", grade=2, class_number=3, student_number=99,
    )


@pytest_asyncio.fixture
async def course(db_session, semester, teacher_user):
    c = Course(
        semester_id=semester.id, teacher_id=teacher_user.id,
        subject="수학", class_name="2-3", name="2-3 수학",
    )
    db_session.add(c)
    await db_session.flush()
    return c


@pytest_asyncio.fixture
async def enrolled_student(db_session, course, student_user):
    cs = CourseStudent(course_id=course.id, student_id=student_user.id, status="active")
    db_session.add(cs)
    await db_session.flush()
    return cs


@pytest_asyncio.fixture
async def draft_survey(db_session, course, teacher_user):
    s = Survey(
        course_id=course.id, author_id=teacher_user.id,
        title="이해도 체크", status="draft",
        is_anonymous=False, allow_multiple_responses=False,
        access_mode="course_members",
    )
    db_session.add(s)
    await db_session.flush()
    # 질문 2개: 객관식(필수), 단답형(선택)
    q1 = SurveyQuestion(
        survey_id=s.id, order=0,
        question_text="오늘 수업 이해도는?",
        question_type="single_choice", is_required=True,
        options=["매우 잘", "보통", "어렵다"],
    )
    q2 = SurveyQuestion(
        survey_id=s.id, order=1,
        question_text="추가 의견",
        question_type="long_text", is_required=False,
    )
    db_session.add_all([q1, q2])
    await db_session.flush()
    return {"survey": s, "q1": q1, "q2": q2}


@pytest_asyncio.fixture
async def active_survey(db_session, draft_survey):
    s = draft_survey["survey"]
    s.status = "active"
    await db_session.flush()
    return draft_survey


# ── permission 가드 ──────────────────────────────────────


@pytest.mark.asyncio
async def test_student_cannot_view_results(
    app_client, active_survey, student_user, enrolled_student, auth_headers,
):
    """강좌 학생도 다른 사람 설문 결과 조회 403."""
    res = await app_client.get(
        f"/api/classroom/surveys/{active_survey['survey'].id}/results",
        headers=auth_headers(student_user),
    )
    # require_permission("classroom.survey.view_results")가 student에 부여 안 됨
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_other_student_cannot_respond(
    app_client, active_survey, other_student, auth_headers,
):
    """강좌 비멤버 학생은 course_members 모드 설문 403."""
    sid = active_survey["survey"].id
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/responses",
        json={"answers": [{"question_id": active_survey["q1"].id, "choice_values": ["보통"]}]},
        headers=auth_headers(other_student),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_draft_survey_cannot_be_responded(
    app_client, draft_survey, student_user, enrolled_student, auth_headers,
):
    """draft 상태의 설문은 응답 불가."""
    sid = draft_survey["survey"].id
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/responses",
        json={"answers": [{"question_id": draft_survey["q1"].id, "choice_values": ["보통"]}]},
        headers=auth_headers(student_user),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_enrolled_student_can_respond_once(
    app_client, active_survey, student_user, enrolled_student, auth_headers,
):
    """강좌 학생은 응답 가능. allow_multiple=False면 두 번째는 409."""
    sid = active_survey["survey"].id
    payload = {
        "answers": [
            {"question_id": active_survey["q1"].id, "choice_values": ["매우 잘"]},
            {"question_id": active_survey["q2"].id, "text_value": "재미있었다"},
        ],
    }
    h = auth_headers(student_user)
    r1 = await app_client.post(f"/api/classroom/surveys/{sid}/responses", json=payload, headers=h)
    assert r1.status_code == 200, r1.text

    r2 = await app_client.post(f"/api/classroom/surveys/{sid}/responses", json=payload, headers=h)
    assert r2.status_code == 409, "중복 응답은 차단되어야 함"


@pytest.mark.asyncio
async def test_required_question_missing_returns_400(
    app_client, active_survey, student_user, enrolled_student, auth_headers,
):
    """필수 질문(q1) 없이 제출하면 400."""
    sid = active_survey["survey"].id
    payload = {
        "answers": [
            {"question_id": active_survey["q2"].id, "text_value": "의견"},
        ],
    }
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/responses", json=payload,
        headers=auth_headers(student_user),
    )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_anonymous_survey_hides_respondent_id(
    app_client, db_session, draft_survey, student_user, enrolled_student, auth_headers,
):
    """is_anonymous=True면 SurveyResponse.respondent_id가 null로 저장."""
    s = draft_survey["survey"]
    s.is_anonymous = True
    s.status = "active"
    await db_session.flush()

    sid = s.id
    payload = {
        "answers": [
            {"question_id": draft_survey["q1"].id, "choice_values": ["매우 잘"]},
        ],
    }
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/responses", json=payload,
        headers=auth_headers(student_user),
    )
    assert res.status_code == 200, res.text

    # DB 확인
    from sqlalchemy import select
    resp = (await db_session.execute(
        select(SurveyResponse).where(SurveyResponse.survey_id == sid)
    )).scalar_one()
    assert resp.respondent_id is None, "익명 모드인데 응답자 id가 기록됨"


@pytest.mark.asyncio
async def test_student_cannot_create_survey(
    app_client, course, student_user, auth_headers,
):
    """학생은 survey.create 권한 없음 → 403."""
    res = await app_client.post(
        "/api/classroom/surveys",
        json={"title": "학생 설문", "course_id": course.id},
        headers=auth_headers(student_user),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_non_author_cannot_edit_questions(
    app_client, draft_survey, other_student, auth_headers,
):
    """작성자 아닌 사용자는 질문 추가 403 (권한 자체가 없음)."""
    sid = draft_survey["survey"].id
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/questions",
        json={
            "question_text": "악의적 추가",
            "question_type": "short_text",
        },
        headers=auth_headers(other_student),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_active_survey_blocks_question_changes(
    app_client, active_survey, teacher_user, auth_headers,
):
    """active 상태에서 질문 추가는 409 (응답자 혼선 방지)."""
    sid = active_survey["survey"].id
    res = await app_client.post(
        f"/api/classroom/surveys/{sid}/questions",
        json={"question_text": "활성 후 추가", "question_type": "short_text"},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_results_csv_export_works(
    app_client, db_session, active_survey, student_user, enrolled_student,
    teacher_user, auth_headers,
):
    """응답 후 CSV export — 작성자(teacher)만 가능, BOM + 한글 헤더."""
    sid = active_survey["survey"].id
    # 학생 응답 제출
    await app_client.post(
        f"/api/classroom/surveys/{sid}/responses",
        json={"answers": [{"question_id": active_survey["q1"].id, "choice_values": ["보통"]}]},
        headers=auth_headers(student_user),
    )

    # 작성자가 CSV 다운로드
    res = await app_client.get(
        f"/api/classroom/surveys/{sid}/results.csv",
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200
    body = res.text
    assert "응답ID" in body and "응답자" in body
    assert active_survey["q1"].question_text in body
