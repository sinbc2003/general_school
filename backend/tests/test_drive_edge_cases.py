"""Drive endpoint edge cases.

검증:
  - 비-존재 자료 ID → 404
  - 비-등록 type → 404
  - 만료 임박 사용자: days_until_expire 반영
  - 즐겨찾기 비-존재 강좌 추가 시도 → 404
  - drive_me unlimited 사용자
"""

from datetime import datetime, timedelta, timezone
import pytest


@pytest.mark.asyncio
async def test_drive_delete_nonexistent_returns_404(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.delete(
        "/api/drive/items/docs/999999",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_drive_restore_nonexistent_returns_404(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.post(
        "/api/drive/items/docs/999999/restore",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_drive_invalid_type_returns_404(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.delete(
        "/api/drive/items/invalid_type/1",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_drive_items_invalid_type_returns_400(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.get(
        "/api/drive/items?type=invalid",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_drive_me_expires_at_reflected(
    app_client, db_session, teacher_user, auth_headers,
):
    """expires_at가 있으면 days_until_expire 계산."""
    teacher_user.user_type = "temporary"
    teacher_user.expires_at = datetime.now(timezone.utc) + timedelta(days=5)
    await db_session.commit()

    r = await app_client.get("/api/drive/me", headers=auth_headers(teacher_user))
    data = r.json()
    assert data["user_type"] == "temporary"
    assert data["days_until_expire"] is not None
    assert 4 <= data["days_until_expire"] <= 5


@pytest.mark.asyncio
async def test_drive_me_already_expired_returns_zero(
    app_client, db_session, teacher_user, auth_headers,
):
    teacher_user.user_type = "temporary"
    teacher_user.expires_at = datetime.now(timezone.utc) - timedelta(days=2)
    await db_session.commit()

    r = await app_client.get("/api/drive/me", headers=auth_headers(teacher_user))
    assert r.json()["days_until_expire"] == 0


@pytest.mark.asyncio
async def test_drive_items_type_filter_returns_only_that_type(
    app_client, db_session, teacher_user, auth_headers,
):
    from app.models import ClassroomDocument, ClassroomSheet

    db_session.add_all([
        ClassroomDocument(owner_id=teacher_user.id, title="my-doc"),
        ClassroomSheet(owner_id=teacher_user.id, title="my-sheet"),
    ])
    await db_session.commit()

    r = await app_client.get("/api/drive/items?type=docs", headers=auth_headers(teacher_user))
    items = r.json()["items"]
    types = {it["type"] for it in items}
    assert "docs" in types
    assert "sheets" not in types


# ── 즐겨찾기 edge ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_favorite_nonexistent_course_returns_404(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.post(
        "/api/classroom/courses/999999/favorite",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_favorite_remove_when_not_favorited_returns_200(
    app_client, db_session, teacher_user, auth_headers,
):
    """즐겨찾기 안 한 강좌를 제거 시도 — 멱등 200."""
    from datetime import date
    from app.models import Course, Semester

    sem = Semester(
        name="X", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="X", class_name="1-1", name="X", is_active=True, course_type="subject",
    )
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)

    # 즐겨찾기 안 했는데 제거
    r = await app_client.delete(
        f"/api/classroom/courses/{c.id}/favorite",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200


# ── 공동교사 edge ────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_co_teacher_to_nonexistent_course_returns_404(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.post(
        "/api/classroom/courses/999999/teachers",
        json={"user_id": teacher_user.id},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_owner_as_co_teacher_returns_409(
    app_client, db_session, teacher_user, auth_headers,
):
    """owner를 본인 강좌의 co_teacher로 추가 시도 — 409 conflict."""
    from datetime import date
    from app.models import Course, Semester

    sem = Semester(
        name="X", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="X", class_name="1-1", name="X", is_active=True, course_type="subject",
    )
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)

    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/teachers",
        json={"user_id": teacher_user.id},  # owner
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_remove_co_teacher_owner_blocked(
    app_client, db_session, teacher_user, auth_headers,
):
    """owner 제거 시도 — 400 (소유권 이관 필요)."""
    from datetime import date
    from app.models import Course, Semester

    sem = Semester(
        name="X", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="X", class_name="1-1", name="X", is_active=True, course_type="subject",
    )
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)

    r = await app_client.delete(
        f"/api/classroom/courses/{c.id}/teachers/{teacher_user.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 400
