"""공동교사(co_teacher) 강좌 권한 회귀 테스트.

배경:
  강좌 권한 SSOT는 is_course_editor = owner(Course.teacher_id) OR co_teacher(CourseTeacher).
  과거 협업 자료(docs/slides/sheets/hwps)의 _resolve_permission, 설문 can_respond,
  그리고 docs/slides/sheets 목록 쿼리 + 강좌 목록(/courses, /courses/_archived)이
  course.teacher_id(owner)만 검사해 **co_teacher를 누락**했다.
  → co_teacher가 본인이 공동담당하는 강좌의 공유 자료를 편집 못하고 열람만 되거나,
    목록에서 강좌·자료가 안 보이는 버그.

이 테스트는 그 전체 버그군을 고정한다:
  - resolve_permission(docs/slides/sheets/hwps) → co_teacher는 editor(can_write)
  - can_respond(survey) → co_teacher 응답 가능
  - 목록(/courses, /courses/_archived, /docs) → co_teacher가 공동담당 강좌·자료를 봄
  - 음성 대조: 강좌와 무관한 교사는 여전히 접근 불가 (과대부여 방지)

회귀 위험:
  누군가 위 가드를 다시 `course.teacher_id == user.id`로 되돌리면 fail.
"""

from datetime import date

import pytest
import pytest_asyncio

from app.models.classroom import Course
from app.models.classroom_docs import ClassroomDocument
from app.models.classroom_hwp import ClassroomHwp
from app.models.classroom_sheets import ClassroomSheet
from app.models.classroom_slides import ClassroomPresentation
from app.models.classroom_surveys import Survey
from app.models.course_teacher import CourseTeacher
from app.models.timetable import Semester
from tests.conftest import _create_user

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
async def past_semester(db_session):
    s = Semester(
        year=2025, semester=2, name="2025-2", is_current=False,
        start_date=date(2025, 9, 1), end_date=date(2026, 2, 20),
    )
    db_session.add(s)
    await db_session.flush()
    return s


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
async def co_teacher(db_session, course):
    """course의 공동교사 (owner 아님)."""
    u = await _create_user(
        db_session, email="coteach@test.local", name="Co Teacher", role="teacher",
    )
    db_session.add(CourseTeacher(course_id=course.id, user_id=u.id, role="co_teacher"))
    await db_session.commit()
    return u


@pytest_asyncio.fixture
async def outsider_teacher(db_session, seed_perms):
    """강좌와 전혀 무관한 교사 (음성 대조)."""
    return await _create_user(
        db_session, email="outsider_t@test.local", name="Outsider Teacher",
        role="teacher",
    )


@pytest_asyncio.fixture
async def doc(db_session, course, teacher_user):
    d = ClassroomDocument(
        course_id=course.id, owner_id=teacher_user.id,
        title="공유 문서", access_mode="course_members",
    )
    db_session.add(d)
    await db_session.flush()
    return d


@pytest_asyncio.fixture
async def sheet(db_session, course, teacher_user):
    s = ClassroomSheet(
        course_id=course.id, owner_id=teacher_user.id,
        title="공유 시트", access_mode="course_members",
    )
    db_session.add(s)
    await db_session.flush()
    return s


@pytest_asyncio.fixture
async def deck(db_session, course, teacher_user):
    d = ClassroomPresentation(
        course_id=course.id, owner_id=teacher_user.id,
        title="공유 덱", access_mode="course_members",
    )
    db_session.add(d)
    await db_session.flush()
    return d


@pytest_asyncio.fixture
async def hwp(db_session, course, teacher_user):
    h = ClassroomHwp(
        course_id=course.id, owner_id=teacher_user.id,
        title="공유 HWP", access_mode="course_members",
    )
    db_session.add(h)
    await db_session.flush()
    return h


@pytest_asyncio.fixture
async def survey(db_session, course, teacher_user):
    s = Survey(
        course_id=course.id, author_id=teacher_user.id,
        title="이해도 설문", status="active",
        is_anonymous=False, allow_multiple_responses=False,
        access_mode="course_members",
    )
    db_session.add(s)
    await db_session.flush()
    return s


# ── resolve_permission: co_teacher는 editor ────────────────


@pytest.mark.asyncio
async def test_coteacher_editor_on_course_doc(db_session, co_teacher, doc):
    from app.modules.classroom_docs._helpers import resolve_permission
    perm = await resolve_permission(db_session, co_teacher, doc)
    assert perm["can_write"] is True
    assert perm["role"] == "editor"


@pytest.mark.asyncio
async def test_coteacher_editor_on_course_sheet(db_session, co_teacher, sheet):
    from app.modules.classroom_sheets.router import _resolve_permission
    perm = await _resolve_permission(db_session, co_teacher, sheet)
    assert perm["can_write"] is True
    assert perm["role"] == "editor"


@pytest.mark.asyncio
async def test_coteacher_editor_on_course_deck(db_session, co_teacher, deck):
    from app.modules.classroom_slides._helpers import resolve_permission
    perm = await resolve_permission(db_session, co_teacher, deck)
    assert perm["can_write"] is True
    assert perm["role"] == "editor"


@pytest.mark.asyncio
async def test_coteacher_write_on_course_hwp(db_session, co_teacher, hwp):
    from app.modules.classroom_hwps.router import _resolve_permission
    perm = await _resolve_permission(db_session, co_teacher, hwp)
    assert perm["can_write"] is True
    assert perm["can_share"] is True  # hwp: 교사는 share 가능
    assert perm["role"] == "teacher"


@pytest.mark.asyncio
async def test_coteacher_can_respond_course_survey(db_session, co_teacher, survey):
    from app.modules.classroom_surveys._helpers import can_respond
    assert await can_respond(db_session, co_teacher, survey) is True


# ── 음성 대조: 무관한 교사는 접근/응답 불가 (과대부여 방지) ──


@pytest.mark.asyncio
async def test_outsider_teacher_no_write_on_course_doc(db_session, outsider_teacher, doc):
    from app.modules.classroom_docs._helpers import resolve_permission
    perm = await resolve_permission(db_session, outsider_teacher, doc)
    assert perm["can_read"] is False
    assert perm["can_write"] is False
    assert perm["role"] is None


@pytest.mark.asyncio
async def test_outsider_teacher_cannot_respond_survey(db_session, outsider_teacher, survey):
    from app.modules.classroom_surveys._helpers import can_respond
    assert await can_respond(db_session, outsider_teacher, survey) is False


# ── 목록 엔드포인트: co_teacher가 공동담당 강좌·자료를 봄 ──


@pytest.mark.asyncio
async def test_coteacher_sees_cotaught_course_in_list(
    app_client, db_session, course, co_teacher, auth_headers,
):
    await db_session.commit()
    res = await app_client.get("/api/classroom/courses", headers=auth_headers(co_teacher))
    assert res.status_code == 200
    ids = [c["id"] for c in res.json()["items"]]
    assert course.id in ids, "공동교사가 공동담당 강좌를 목록에서 봐야 함"


@pytest.mark.asyncio
async def test_coteacher_sees_course_doc_in_list(
    app_client, db_session, course, co_teacher, doc, auth_headers,
):
    await db_session.commit()
    res = await app_client.get("/api/classroom/docs", headers=auth_headers(co_teacher))
    assert res.status_code == 200
    ids = [d["id"] for d in res.json()["items"]]
    assert doc.id in ids, "공동교사가 공동담당 강좌의 course_members 문서를 목록에서 봐야 함"


@pytest.mark.asyncio
async def test_coteacher_sees_cotaught_archived_course(
    app_client, db_session, past_semester, teacher_user, co_teacher, auth_headers,
):
    """지난 학기 공동담당 강좌도 /courses/_archived 에서 보여야 함."""
    pc = Course(
        semester_id=past_semester.id, teacher_id=teacher_user.id,
        subject="물리", class_name="3-1", name="3-1 물리",
    )
    db_session.add(pc)
    await db_session.flush()
    db_session.add(CourseTeacher(course_id=pc.id, user_id=co_teacher.id, role="co_teacher"))
    await db_session.commit()

    res = await app_client.get(
        "/api/classroom/courses/_archived", headers=auth_headers(co_teacher),
    )
    assert res.status_code == 200
    ids = [c["id"] for c in res.json()["items"]]
    assert pc.id in ids, "공동교사가 지난 학기 공동담당 강좌를 보관 목록에서 봐야 함"
