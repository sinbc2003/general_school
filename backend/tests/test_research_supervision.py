"""연구 담당교사 매핑 (ResearchSupervision) 통합 테스트.

검증:
- CRUD: admin은 자유, 일반 교사는 본인만
- CSV 일괄 import + dry_run
- IDOR: 다른 교사 매핑 변경 차단
"""

from __future__ import annotations

import io
from datetime import date

import pytest
from sqlalchemy import select

from app.models import ResearchSupervision, Semester


async def _make_semester(db, year=2026, sem=1, is_current=True) -> Semester:
    s = Semester(
        year=year, semester=sem, name=f"{year} {sem}학기",
        start_date=date(year, 3, 1), end_date=date(year, 8, 31),
        is_current=is_current,
    )
    db.add(s)
    await db.flush()
    return s


@pytest.mark.security
@pytest.mark.asyncio
async def test_admin_creates_supervision(app_client, db_session, super_admin, teacher_user, student_user, auth_headers):
    semester = await _make_semester(db_session)
    await db_session.commit()

    r = await app_client.post(
        "/api/past-research/_supervisions",
        json={
            "semester_id": semester.id,
            "student_id": student_user.id,
            "supervisor_id": teacher_user.id,
            "topic_title": "테스트 연구 주제",
        },
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    sid = r.json()["id"]

    row = (await db_session.execute(
        select(ResearchSupervision).where(ResearchSupervision.id == sid)
    )).scalar_one()
    assert row.student_id == student_user.id
    assert row.supervisor_id == teacher_user.id
    assert row.topic_title == "테스트 연구 주제"


@pytest.mark.security
@pytest.mark.asyncio
async def test_teacher_can_only_assign_self_as_supervisor(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """일반 교사는 본인을 supervisor로만 등록 가능."""
    semester = await _make_semester(db_session)
    # 다른 교사 생성
    from tests.conftest import _create_user
    other_teacher = await _create_user(
        db_session, email="other@test.local", name="Other Teacher", role="teacher",
    )
    await db_session.commit()

    # 본인을 supervisor로는 OK
    r1 = await app_client.post(
        "/api/past-research/_supervisions",
        json={
            "semester_id": semester.id,
            "student_id": student_user.id,
            "supervisor_id": teacher_user.id,
        },
        headers=auth_headers(teacher_user),
    )
    assert r1.status_code == 200

    # 다른 교사를 supervisor로는 차단 (이미 매핑 있어서 409 또는 403)
    r2 = await app_client.post(
        "/api/past-research/_supervisions",
        json={
            "semester_id": semester.id,
            "student_id": student_user.id,
            "supervisor_id": other_teacher.id,
        },
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 403


@pytest.mark.security
@pytest.mark.asyncio
async def test_list_supervisions_teacher_sees_only_own(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """교사는 본인이 supervisor인 매핑만 list에서 봄."""
    semester = await _make_semester(db_session)
    from tests.conftest import _create_user
    other_teacher = await _create_user(
        db_session, email="other2@test.local", name="Other2", role="teacher",
    )
    other_student = await _create_user(
        db_session, email="other_stu@test.local", name="OtherStu",
        role="student", grade=2, class_number=1, student_number=5,
    )
    # 두 매핑: 본인 + 다른 교사
    db_session.add_all([
        ResearchSupervision(
            semester_id=semester.id, student_id=student_user.id,
            supervisor_id=teacher_user.id,
        ),
        ResearchSupervision(
            semester_id=semester.id, student_id=other_student.id,
            supervisor_id=other_teacher.id,
        ),
    ])
    await db_session.commit()

    r = await app_client.get(
        f"/api/past-research/_supervisions?semester_id={semester.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["supervisor_id"] == teacher_user.id


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_bulk_import_dry_run(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    """CSV bulk import — dry_run은 DB 변경 안 함."""
    semester = await _make_semester(db_session)
    await db_session.commit()

    csv_text = (
        "student_username,supervisor_username,topic_title\n"
        f"{student_user.username},{teacher_user.username},주제\n"
        "nonexistent,xxx,fail\n"
    )
    r = await app_client.post(
        "/api/past-research/_supervisions/_bulk-import",
        data={"semester_id": str(semester.id), "dry_run": "true"},
        files={"file": ("test.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["added"] == 1
    assert len(data["failed"]) == 1
    assert data["applied"] is False

    # dry_run이라 DB에 row 없음
    count = (await db_session.execute(
        select(ResearchSupervision)
    )).scalars().all()
    assert len(count) == 0


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_bulk_import_actual(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    """CSV bulk import — 실제 등록."""
    semester = await _make_semester(db_session)
    await db_session.commit()

    csv_text = (
        "student_username,supervisor_username,topic_title\n"
        f"{student_user.username},{teacher_user.username},실제 주제\n"
    )
    r = await app_client.post(
        "/api/past-research/_supervisions/_bulk-import",
        data={"semester_id": str(semester.id), "dry_run": "false"},
        files={"file": ("test.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["added"] == 1

    row = (await db_session.execute(
        select(ResearchSupervision).where(ResearchSupervision.student_id == student_user.id)
    )).scalar_one_or_none()
    assert row is not None
    assert row.supervisor_id == teacher_user.id
    assert row.topic_title == "실제 주제"


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_bulk_updates_existing(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    """기존 매핑 있으면 supervisor 변경 (updated)."""
    semester = await _make_semester(db_session)
    from tests.conftest import _create_user
    new_teacher = await _create_user(
        db_session, email="new_t@test.local", name="New Teacher", role="teacher",
    )
    db_session.add(ResearchSupervision(
        semester_id=semester.id, student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    await db_session.commit()

    csv_text = (
        "student_username,supervisor_username,topic_title\n"
        f"{student_user.username},{new_teacher.username},변경된 주제\n"
    )
    r = await app_client.post(
        "/api/past-research/_supervisions/_bulk-import",
        data={"semester_id": str(semester.id), "dry_run": "false"},
        files={"file": ("test.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 1

    await db_session.commit()
    row = (await db_session.execute(
        select(ResearchSupervision).where(ResearchSupervision.student_id == student_user.id)
    )).scalar_one()
    assert row.supervisor_id == new_teacher.id
    assert row.topic_title == "변경된 주제"


@pytest.mark.security
@pytest.mark.asyncio
async def test_csv_bulk_max_rows_enforced(
    app_client, db_session, super_admin, auth_headers,
):
    """5000행 초과 거부 (DoS 방어)."""
    semester = await _make_semester(db_session)
    await db_session.commit()

    lines = ["student_username,supervisor_username,topic_title"]
    lines.extend(f"s{i},t{i}," for i in range(5001))
    csv_text = "\n".join(lines)

    r = await app_client.post(
        "/api/past-research/_supervisions/_bulk-import",
        data={"semester_id": str(semester.id), "dry_run": "true"},
        files={"file": ("big.csv", csv_text.encode("utf-8"), "text/csv")},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.security
@pytest.mark.asyncio
async def test_student_cannot_supervise(app_client, student_user, auth_headers):
    """학생은 supervise 권한 없음."""
    r = await app_client.get(
        "/api/past-research/_supervisions",
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403
