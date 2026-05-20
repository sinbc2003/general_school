"""부서 CRUD + 권한 위임 통합 테스트.

검증:
  - GET/POST/PUT/DELETE /api/departments
  - POST /_bulk 멱등
  - delegation: 부장만 위임 가능, BLOCKED_PREFIXES 차단, escalation 차단
"""

import pytest
from sqlalchemy import select

from app.models import Department, User
from app.models.permission import Permission, UserPermission


@pytest.mark.asyncio
async def test_create_department(app_client, super_admin, auth_headers):
    r = await app_client.post(
        "/api/departments",
        json={"name": "교무부", "description": "교무 행정"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "교무부"


@pytest.mark.asyncio
async def test_duplicate_department_rejected(app_client, super_admin, auth_headers):
    await app_client.post(
        "/api/departments", json={"name": "교무부"}, headers=auth_headers(super_admin),
    )
    r = await app_client.post(
        "/api/departments", json={"name": "교무부"}, headers=auth_headers(super_admin),
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_bulk_create_idempotent(app_client, super_admin, auth_headers):
    body = {"departments": [{"name": "A"}, {"name": "B"}, {"name": "C"}]}
    r1 = await app_client.post(
        "/api/departments/_bulk", json=body, headers=auth_headers(super_admin),
    )
    assert r1.json()["created"] == 3

    # 같은 요청 다시 — 모두 skip
    r2 = await app_client.post(
        "/api/departments/_bulk", json=body, headers=auth_headers(super_admin),
    )
    assert r2.json()["created"] == 0
    assert r2.json()["skipped"] == 3


@pytest.mark.asyncio
async def test_teacher_cannot_manage_departments(
    app_client, teacher_user, auth_headers,
):
    """교사는 department.manage 권한 없음 (TEACHER_EXCLUDE_KEYS)."""
    r = await app_client.post(
        "/api/departments", json={"name": "X"}, headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_department_nulls_user_department_id(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    # 부서 생성 + 교사 소속
    dept = Department(name="제거대상")
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id
    await db_session.commit()
    dept_id = dept.id

    r = await app_client.delete(
        f"/api/departments/{dept_id}", headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    await db_session.refresh(teacher_user)
    assert teacher_user.department_id is None  # FK SET NULL


# ── Delegation ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lead_can_delegate_within_own_permissions(
    app_client, db_session, teacher_user, auth_headers,
):
    """부장이 본인 권한 안에서 위임 가능."""
    # 또 다른 교사를 만들고 부서장으로 지정
    from tests.conftest import _create_user
    member = await _create_user(
        db_session, email="member@test.local", name="Member", role="teacher",
    )

    dept = Department(name="부서A", lead_user_id=teacher_user.id)
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id
    member.department_id = dept.id
    await db_session.commit()

    # teacher_user는 default로 거의 모든 권한 보유. 그 중 위임 가능한 키 1개 선택.
    # classroom.course.view는 teacher 기본 권한.
    r = await app_client.post(
        f"/api/departments/{dept.id}/delegations",
        json={"user_id": member.id, "permission_key": "classroom.course.view"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    # 위임 list에 나타남
    r = await app_client.get(
        f"/api/departments/{dept.id}/delegations",
        headers=auth_headers(teacher_user),
    )
    keys = [d["permission_key"] for d in r.json()["items"]]
    assert "classroom.course.view" in keys


@pytest.mark.asyncio
async def test_non_lead_cannot_delegate(
    app_client, db_session, teacher_user, auth_headers,
):
    """부장이 아닌 교사는 위임 불가."""
    from tests.conftest import _create_user
    other_teacher = await _create_user(
        db_session, email="other@test.local", name="Other", role="teacher",
    )

    dept = Department(name="부서B", lead_user_id=other_teacher.id)
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id
    await db_session.commit()

    # teacher_user는 부장 아님 → 위임 불가
    r = await app_client.post(
        f"/api/departments/{dept.id}/delegations",
        json={"user_id": teacher_user.id, "permission_key": "classroom.course.view"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delegation_blocked_prefix_rejected(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    """system.*, permission.manage.* 등 차단된 권한은 위임 불가 (admin도 차단)."""
    dept = Department(name="부서C", lead_user_id=super_admin.id)
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id
    await db_session.commit()

    # super_admin이 시도해도 차단
    r = await app_client.post(
        f"/api/departments/{dept.id}/delegations",
        json={"user_id": teacher_user.id, "permission_key": "system.settings.edit"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delegation_to_non_member_rejected(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    """부서 소속이 아닌 사용자에게 위임 불가."""
    dept = Department(name="부서D", lead_user_id=super_admin.id)
    db_session.add(dept)
    await db_session.flush()
    await db_session.commit()
    # teacher_user.department_id == None (부서 소속 아님)

    r = await app_client.post(
        f"/api/departments/{dept.id}/delegations",
        json={"user_id": teacher_user.id, "permission_key": "classroom.course.view"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_revoke_delegation(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    dept = Department(name="부서E", lead_user_id=super_admin.id)
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id

    # 권한 부여
    perm = (await db_session.execute(
        select(Permission).where(Permission.key == "classroom.course.view")
    )).scalar_one_or_none()
    db_session.add(UserPermission(user_id=teacher_user.id, permission_id=perm.id, granted_by=super_admin.id))
    await db_session.commit()

    # 회수
    r = await app_client.delete(
        f"/api/departments/{dept.id}/delegations/{teacher_user.id}/classroom.course.view",
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    # DB에서 제거됨
    remaining = (await db_session.execute(
        select(UserPermission).where(
            UserPermission.user_id == teacher_user.id,
            UserPermission.permission_id == perm.id,
        )
    )).scalar_one_or_none()
    assert remaining is None
