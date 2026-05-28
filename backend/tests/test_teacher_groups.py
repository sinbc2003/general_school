"""교사 임시 그룹 (TeacherGroup) 통합 테스트.

검증:
- 부장만 그룹 생성 (Department.lead_user_id), admin은 자유
- owner는 멤버 초대·삭제
- 참여 교사는 학생 학번 검색해 배정 → 본인이 담당
- 학생은 본인 그룹에만 산출물 제출
- 담당 교사만 산출물 review (승인 → StudentArtifact)
- IDOR: 다른 교사 담당 학생을 가로채지 못함
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from app.models import (
    Department, GroupSubmission, Notification, Semester, StudentArtifact,
    TeacherGroup, TeacherGroupMember, TeacherGroupStudent,
)


async def _make_semester(db):
    s = Semester(
        year=2026, semester=1, name="2026-1",
        start_date=date(2026, 3, 1), end_date=date(2026, 8, 31),
        is_current=True,
    )
    db.add(s)
    await db.flush()
    return s


@pytest.mark.security
@pytest.mark.asyncio
async def test_admin_creates_group(app_client, db_session, super_admin, auth_headers):
    sem = await _make_semester(db_session)
    await db_session.commit()
    r = await app_client.post(
        "/api/teacher-groups",
        json={"semester_id": sem.id, "name": "2026 수학경시", "type": "contest"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    g = await db_session.get(TeacherGroup, r.json()["id"])
    assert g.owner_id == super_admin.id


@pytest.mark.security
@pytest.mark.asyncio
async def test_non_lead_teacher_cannot_create_group(
    app_client, db_session, teacher_user, auth_headers,
):
    """부장 아닌 일반 교사 → 그룹 생성 403."""
    sem = await _make_semester(db_session)
    await db_session.commit()
    r = await app_client.post(
        "/api/teacher-groups",
        json={"semester_id": sem.id, "name": "test", "type": "event"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.security
@pytest.mark.asyncio
async def test_department_lead_can_create_group(
    app_client, db_session, teacher_user, auth_headers,
):
    """Department.lead_user_id = 본인이면 부장 = 그룹 생성 OK."""
    sem = await _make_semester(db_session)
    dept = Department(name="과학부", lead_user_id=teacher_user.id, sort_order=1)
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id
    await db_session.commit()

    r = await app_client.post(
        "/api/teacher-groups",
        json={"semester_id": sem.id, "name": "과학탐구대회", "type": "contest"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200


@pytest.mark.security
@pytest.mark.asyncio
async def test_owner_invites_member_with_notification(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    sem = await _make_semester(db_session)
    g = TeacherGroup(semester_id=sem.id, name="G", type="event", owner_id=super_admin.id)
    db_session.add(g)
    await db_session.commit()

    r = await app_client.post(
        f"/api/teacher-groups/{g.id}/_members",
        json={"teacher_id": teacher_user.id, "role": "member"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    # 알림 확인
    notif = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == teacher_user.id,
            Notification.type == "teacher_group.invited",
        )
    )).scalar_one_or_none()
    assert notif is not None


@pytest.mark.security
@pytest.mark.asyncio
async def test_member_assigns_student_by_username(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    sem = await _make_semester(db_session)
    g = TeacherGroup(semester_id=sem.id, name="G", type="event", owner_id=super_admin.id)
    db_session.add(g)
    await db_session.flush()
    db_session.add(TeacherGroupMember(group_id=g.id, teacher_id=teacher_user.id, role="member"))
    await db_session.commit()

    # 교사가 학생 학번으로 배정
    r = await app_client.post(
        f"/api/teacher-groups/{g.id}/_students",
        json={"username": student_user.username},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    s = (await db_session.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == g.id,
            TeacherGroupStudent.student_id == student_user.id,
        )
    )).scalar_one()
    assert s.assigned_teacher_id == teacher_user.id


@pytest.mark.security
@pytest.mark.asyncio
async def test_other_teacher_cannot_reassign(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    """다른 교사가 이미 담당 학생을 본인 담당으로 가로채는 거 차단."""
    sem = await _make_semester(db_session)
    g = TeacherGroup(semester_id=sem.id, name="G", type="event", owner_id=super_admin.id)
    db_session.add(g)
    await db_session.flush()

    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="other@test.local", name="Other", role="teacher",
    )
    db_session.add_all([
        TeacherGroupMember(group_id=g.id, teacher_id=teacher_user.id, role="member"),
        TeacherGroupMember(group_id=g.id, teacher_id=other.id, role="member"),
        TeacherGroupStudent(
            group_id=g.id, student_id=student_user.id,
            assigned_teacher_id=teacher_user.id,
        ),
    ])
    await db_session.commit()

    # 다른 교사가 같은 학생 재배정 시도
    r = await app_client.post(
        f"/api/teacher-groups/{g.id}/_students",
        json={"username": student_user.username},
        headers=auth_headers(other),
    )
    assert r.status_code == 409


@pytest.mark.security
@pytest.mark.asyncio
async def test_student_search_by_username_or_name(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    r = await app_client.get(
        f"/api/teacher-groups/_students/_search?q={student_user.username}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(i["id"] == student_user.id for i in items)

    # 이름으로도 검색
    r2 = await app_client.get(
        f"/api/teacher-groups/_students/_search?q={student_user.name}",
        headers=auth_headers(teacher_user),
    )
    items2 = r2.json()["items"]
    assert any(i["id"] == student_user.id for i in items2)


@pytest.mark.security
@pytest.mark.asyncio
async def test_student_submit_and_review_approved(
    app_client, db_session, super_admin, teacher_user, student_user, auth_headers,
):
    """학생 제출 → 담당 교사 승인 → StudentArtifact 자동 생성."""
    sem = await _make_semester(db_session)
    g = TeacherGroup(semester_id=sem.id, name="G", type="event", owner_id=super_admin.id)
    db_session.add(g)
    await db_session.flush()
    db_session.add_all([
        TeacherGroupMember(group_id=g.id, teacher_id=teacher_user.id, role="member"),
        TeacherGroupStudent(
            group_id=g.id, student_id=student_user.id,
            assigned_teacher_id=teacher_user.id,
        ),
    ])
    await db_session.commit()

    # 학생 제출
    r = await app_client.post(
        f"/api/teacher-groups/{g.id}/_submissions",
        data={"title": "탐구 결과", "description": "설명"},
        files={"file": ("report.pdf", b"%PDF-1.4 dummy", "application/pdf")},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    sid = r.json()["id"]

    # 담당 교사 승인
    r2 = await app_client.patch(
        f"/api/teacher-groups/_submissions/{sid}/_review",
        json={"status": "approved"},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200

    sub = await db_session.get(GroupSubmission, sid)
    assert sub.status == "approved"
    assert sub.student_artifact_id is not None

    artifact = await db_session.get(StudentArtifact, sub.student_artifact_id)
    assert artifact.student_id == student_user.id


@pytest.mark.security
@pytest.mark.asyncio
async def test_student_cannot_submit_to_unassigned_group(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    sem = await _make_semester(db_session)
    g = TeacherGroup(semester_id=sem.id, name="G", type="event", owner_id=super_admin.id)
    db_session.add(g)
    await db_session.commit()

    r = await app_client.post(
        f"/api/teacher-groups/{g.id}/_submissions",
        data={"title": "no"},
        files={"file": ("a.pdf", b"%PDF-1.4 dummy", "application/pdf")},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 403
