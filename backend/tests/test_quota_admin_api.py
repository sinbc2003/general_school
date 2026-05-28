"""POST /api/users/{id}/quota + /_quota/bulk 회귀 테스트 (위험 3 — quota 관리 API).

검증:
  - super_admin이 student quota_mb=300 변경 → 200, quota_bytes 반영
  - super_admin 대상자에게 quota_mb=500 → 400 ("최고관리자는 항상 무제한")
  - super_admin 대상자에게 quota_mb=0 → 200 (OK, 무제한 유지)
  - 음수 → 400
  - 권한 없는 teacher → 403
  - 존재하지 않는 user_id → 404
  - 일괄: role="student", quota_mb=300 → 모든 student quota 변경
  - 일괄: role="super_admin" → 400 (대상 제외)
  - 일괄: 음수 → 400
  - audit log user_quota_update / user_quota_bulk_update + is_sensitive=True 생성
  - user.manage.quota 권한 시드 확인 (_REGISTERED_KEYS 등록)
"""

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.user import User


# ── user.manage.quota 권한 시드 ──────────────────────────────


def test_quota_permission_registered_in_keys():
    """라우터 import 시점에 user.manage.quota가 _REGISTERED_KEYS에 등록됨."""
    # main.py import → 모든 라우터 import → require_permission 호출 → 등록
    import app.main  # noqa: F401
    from app.core.permissions import get_registered_keys
    assert "user.manage.quota" in get_registered_keys()


def test_quota_permission_in_module_definitions():
    """permissions.py에 정의되어 있어야 부팅 시 자동 시드."""
    from app.modules.users.permissions import PERMISSIONS
    keys = [p["key"] for p in PERMISSIONS]
    assert "user.manage.quota" in keys
    target = next(p for p in PERMISSIONS if p["key"] == "user.manage.quota")
    assert target.get("is_sensitive") is True
    assert target.get("requires_2fa") is True


# ── POST /api/users/{id}/quota ──────────────────────────────


@pytest.mark.asyncio
async def test_super_admin_can_update_student_quota(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{student_user.id}/quota",
        json={"quota_mb": 300},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quota_mb"] == 300
    assert body["quota_bytes"] == 300 * 1024 * 1024
    # DB 반영 확인
    refreshed = await db_session.get(User, student_user.id)
    await db_session.refresh(refreshed)
    assert refreshed.quota_bytes == 300 * 1024 * 1024


@pytest.mark.asyncio
async def test_quota_update_super_admin_target_nonzero_rejected(
    app_client, db_session, super_admin, auth_headers,
):
    """super_admin 대상자에게 0이 아닌 quota → 400."""
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{super_admin.id}/quota",
        json={"quota_mb": 500},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400
    assert "무제한" in r.json()["detail"]


@pytest.mark.asyncio
async def test_quota_update_super_admin_target_zero_ok(
    app_client, db_session, super_admin, auth_headers,
):
    """super_admin 대상자에게 0 (무제한 sentinel) → 200."""
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{super_admin.id}/quota",
        json={"quota_mb": 0},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["quota_bytes"] == 0


@pytest.mark.asyncio
async def test_quota_update_negative_rejected(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{student_user.id}/quota",
        json={"quota_mb": -10},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400
    assert "0 이상" in r.json()["detail"]


@pytest.mark.asyncio
async def test_quota_update_teacher_forbidden(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """평범한 teacher는 user.manage.quota 권한 없음 → 403."""
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{student_user.id}/quota",
        json={"quota_mb": 100},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_quota_update_unknown_user_404(
    app_client, db_session, super_admin, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        "/api/users/999999/quota",
        json={"quota_mb": 100},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_quota_update_writes_sensitive_audit_log(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    """변경 성공 시 user_quota_update + is_sensitive=True audit log 생성."""
    await db_session.commit()
    r = await app_client.post(
        f"/api/users/{student_user.id}/quota",
        json={"quota_mb": 250},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    # 직접 DB 조회 (app_client 트랜잭션 commit됨)
    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user_quota_update")
    )).scalars().all()
    assert len(rows) >= 1
    last = rows[-1]
    assert last.is_sensitive is True
    assert last.target == student_user.email
    assert "250MB" in (last.detail or "")


# ── POST /api/users/_quota/bulk ─────────────────────────────


@pytest.mark.asyncio
async def test_quota_bulk_update_student_role(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    """role=student bulk 변경 → 모든 student quota 일괄 변경."""
    # 추가 학생 1명 더
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="another@t.local", name="A2", role="student",
    )
    await db_session.commit()

    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "student", "quota_mb": 300},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "student"
    assert body["quota_mb"] == 300
    assert body["quota_bytes"] == 300 * 1024 * 1024
    assert body["affected_count"] >= 2  # 두 학생

    # DB 반영
    s1 = await db_session.get(User, student_user.id)
    await db_session.refresh(s1)
    assert s1.quota_bytes == 300 * 1024 * 1024
    s2 = await db_session.get(User, other.id)
    await db_session.refresh(s2)
    assert s2.quota_bytes == 300 * 1024 * 1024


@pytest.mark.asyncio
async def test_quota_bulk_update_super_admin_role_rejected(
    app_client, db_session, super_admin, auth_headers,
):
    """role=super_admin bulk → 400 (대상에서 제외)."""
    await db_session.commit()
    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "super_admin", "quota_mb": 1024},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_quota_bulk_update_invalid_role_rejected(
    app_client, db_session, super_admin, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "nonexistent_role", "quota_mb": 100},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_quota_bulk_update_negative_rejected(
    app_client, db_session, super_admin, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "teacher", "quota_mb": -1},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_quota_bulk_update_writes_sensitive_audit_log(
    app_client, db_session, super_admin, student_user, auth_headers,
):
    await db_session.commit()
    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "student", "quota_mb": 150},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.action == "user_quota_bulk_update")
    )).scalars().all()
    assert len(rows) >= 1
    last = rows[-1]
    assert last.is_sensitive is True
    assert last.target == "role:student"
    assert "150" in (last.detail or "")


@pytest.mark.asyncio
async def test_quota_bulk_update_teacher_forbidden(
    app_client, db_session, teacher_user, auth_headers,
):
    """user.manage.quota 권한 없는 teacher → 403."""
    await db_session.commit()
    r = await app_client.post(
        "/api/users/_quota/bulk",
        json={"role": "student", "quota_mb": 100},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403
