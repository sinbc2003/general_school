"""학기 보관 정책 (Phase F) 회귀 테스트.

course.is_active = False인 강좌:
  - 새 협업 문서 생성 → 409
  - 새 설문 생성 → 409
  - 기존 활성 자료의 응답·편집은 유지 (별도 검증)

회귀 시나리오:
  - 누군가 archived 가드를 우회하는 경로를 추가하면 → fail
"""

from datetime import date

import pytest
import pytest_asyncio

from app.models.classroom import Course
from app.models.timetable import Semester


pytestmark = pytest.mark.security


@pytest_asyncio.fixture
async def archived_course(db_session, teacher_user, seed_perms):
    s = Semester(
        year=2025, semester=1, name="2025-1", is_current=False,
        start_date=date(2025, 3, 1), end_date=date(2025, 7, 20),
    )
    db_session.add(s)
    await db_session.flush()
    c = Course(
        semester_id=s.id, teacher_id=teacher_user.id,
        subject="수학", class_name="1-1", name="2025 1-1 수학",
        is_active=False,
    )
    db_session.add(c)
    await db_session.flush()
    return c


@pytest.mark.asyncio
async def test_archived_course_blocks_new_document(
    app_client, archived_course, teacher_user, auth_headers,
):
    """is_active=false 강좌에서 새 문서 생성 → 409."""
    res = await app_client.post(
        "/api/classroom/docs",
        json={"title": "보관 강좌 새 문서", "course_id": archived_course.id},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 409, f"기대 409, 실제 {res.status_code}: {res.text}"
    assert "보관" in res.json()["detail"]


@pytest.mark.asyncio
async def test_archived_course_blocks_new_survey(
    app_client, archived_course, teacher_user, auth_headers,
):
    """is_active=false 강좌에서 새 설문 생성 → 409."""
    res = await app_client.post(
        "/api/classroom/surveys",
        json={"title": "보관 강좌 설문", "course_id": archived_course.id},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 409
    assert "보관" in res.json()["detail"]


@pytest.mark.asyncio
async def test_active_course_allows_new_document(
    app_client, db_session, teacher_user, auth_headers,
):
    """대조: is_active=true이면 정상 생성 (가드 false-positive 방지)."""
    s = Semester(
        year=2026, semester=1, name="2026-1", is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 20),
    )
    db_session.add(s)
    await db_session.flush()
    c = Course(
        semester_id=s.id, teacher_id=teacher_user.id,
        subject="수학", class_name="2-3", name="활성", is_active=True,
    )
    db_session.add(c)
    await db_session.flush()

    res = await app_client.post(
        "/api/classroom/docs",
        json={"title": "정상 문서", "course_id": c.id},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200
