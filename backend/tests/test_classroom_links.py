"""클래스룸 단축 링크 + QR 보안 테스트.

회귀 시나리오:
1. 다른 사람 설문의 단축 링크 생성 시도 → 403
2. 같은 target에 두 번 생성하면 같은 slug 재사용 (멱등)
3. slug는 base62, 최소 6자
4. 익명 사용자가 resolve 가능 (slug→target_type+id 공개)
5. 만료된 링크는 resolve 410
6. 학생은 link.create 권한 없음 → 403
7. 다른 사용자의 QR 다운로드 시도 → 403
"""

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from app.models.classroom import Course
from app.models.classroom_links import ShortLink
from app.models.classroom_surveys import Survey
from app.models.timetable import Semester
from datetime import date


pytestmark = pytest.mark.security


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
async def other_teacher(db_session, seed_perms):
    from tests.conftest import _create_user
    return await _create_user(
        db_session, email="t2@test.local", name="Other Teacher", role="teacher",
    )


@pytest_asyncio.fixture
async def survey(db_session, semester, teacher_user):
    c = Course(
        semester_id=semester.id, teacher_id=teacher_user.id,
        subject="수학", class_name="2-3", name="수학",
    )
    db_session.add(c)
    await db_session.flush()
    s = Survey(
        course_id=c.id, author_id=teacher_user.id,
        title="피드백", status="active",
    )
    db_session.add(s)
    await db_session.flush()
    return s


# ── 권한 가드 ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_student_cannot_create_link(
    app_client, survey, student_user, auth_headers,
):
    """학생은 link.create 권한 없음 → 403."""
    res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=auth_headers(student_user),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_other_teacher_cannot_create_link_for_others_survey(
    app_client, survey, other_teacher, auth_headers,
):
    """본인 소유가 아닌 설문은 링크 생성 403."""
    res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=auth_headers(other_teacher),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_owner_can_create_link(
    app_client, survey, teacher_user, auth_headers,
):
    """작성자는 링크 생성 OK + slug 형식 검증."""
    res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["target_type"] == "survey"
    assert data["target_id"] == survey.id
    assert len(data["slug"]) >= 6
    assert all(c.isalnum() for c in data["slug"]), "slug는 base62만"
    assert "/q/" in data["short_url"]


@pytest.mark.asyncio
async def test_create_link_idempotent_for_same_target(
    app_client, survey, teacher_user, auth_headers,
):
    """같은 target에 두 번 생성하면 같은 slug 재사용."""
    h = auth_headers(teacher_user)
    r1 = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=h,
    )
    r2 = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=h,
    )
    assert r1.json()["slug"] == r2.json()["slug"], "동일 target은 같은 slug 재사용"


# ── 공개 resolve ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_anonymous_resolve_works(
    app_client, db_session, survey, teacher_user, auth_headers,
):
    """slug → target은 익명에 공개. click_count 1 증가."""
    h = auth_headers(teacher_user)
    create_res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=h,
    )
    slug = create_res.json()["slug"]

    # 익명 (auth 헤더 없이)
    resolve = await app_client.get(f"/q/{slug}/resolve")
    assert resolve.status_code == 200, resolve.text
    data = resolve.json()
    assert data["slug"] == slug
    assert data["target_type"] == "survey"
    assert data["target_id"] == survey.id

    # click_count 증가 확인
    from sqlalchemy import select
    link = (await db_session.execute(
        select(ShortLink).where(ShortLink.slug == slug)
    )).scalar_one()
    assert link.click_count == 1


@pytest.mark.asyncio
async def test_resolve_returns_404_for_unknown_slug(app_client):
    res = await app_client.get("/q/NONEXIST/resolve")
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_expired_link_returns_410(
    app_client, db_session, survey, teacher_user,
):
    """expires_at 지난 링크는 resolve 410."""
    past = datetime.now(timezone.utc) - timedelta(days=1)
    link = ShortLink(
        slug="EXPIRED",
        target_type="survey",
        target_id=survey.id,
        created_by_id=teacher_user.id,
        expires_at=past,
    )
    db_session.add(link)
    await db_session.flush()

    res = await app_client.get("/q/EXPIRED/resolve")
    assert res.status_code == 410


# ── QR endpoint ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_qr_png_requires_owner(
    app_client, survey, teacher_user, other_teacher, auth_headers,
):
    """QR PNG는 생성자/admin만. 다른 교사는 403."""
    h = auth_headers(teacher_user)
    create_res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=h,
    )
    slug = create_res.json()["slug"]

    # 작성자
    r1 = await app_client.get(
        f"/api/classroom/links/{slug}/qr.png",
        headers=auth_headers(teacher_user),
    )
    assert r1.status_code == 200
    assert r1.headers["content-type"] == "image/png"
    assert r1.content.startswith(b"\x89PNG"), "PNG 매직 헤더 확인"

    # 다른 교사
    r2 = await app_client.get(
        f"/api/classroom/links/{slug}/qr.png",
        headers=auth_headers(other_teacher),
    )
    assert r2.status_code == 403


@pytest.mark.asyncio
async def test_qr_svg_works(
    app_client, survey, teacher_user, auth_headers,
):
    """QR SVG도 동작."""
    h = auth_headers(teacher_user)
    create_res = await app_client.post(
        "/api/classroom/links",
        json={"target_type": "survey", "target_id": survey.id},
        headers=h,
    )
    slug = create_res.json()["slug"]
    res = await app_client.get(
        f"/api/classroom/links/{slug}/qr.svg",
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200
    assert "svg" in res.headers["content-type"].lower()
    assert b"<svg" in res.content
