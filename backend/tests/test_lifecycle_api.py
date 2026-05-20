"""인사이동 API 통합 테스트.

검증:
  - PATCH /api/users/{id}/lifecycle: 상태 변경 + 계정 비활성화
  - POST /api/users/{id}/transfer-ownership: 자료 owner 이관 + quota 재계산
  - 마지막 super_admin 보호
  - 만료 계정 자동 비활성화 (disable_expired_accounts)
"""

import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from app.models import ClassroomDocument, User
from app.modules.users.lifecycle import disable_expired_accounts


@pytest.mark.asyncio
async def test_lifecycle_change_to_departed_disables_account(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    r = await app_client.patch(
        f"/api/users/{teacher_user.id}/lifecycle",
        json={"lifecycle_status": "departed", "disable_account": True},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["lifecycle_status"] == "departed"
    assert data["status"] == "disabled"


@pytest.mark.asyncio
async def test_lifecycle_change_keep_account_active(
    app_client, super_admin, student_user, auth_headers,
):
    r = await app_client.patch(
        f"/api/users/{student_user.id}/lifecycle",
        json={"lifecycle_status": "graduated", "disable_account": False},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["lifecycle_status"] == "graduated"
    assert data["status"] == "approved"  # disable_account=False면 status 유지


@pytest.mark.asyncio
async def test_lifecycle_invalid_status_rejected(
    app_client, super_admin, teacher_user, auth_headers,
):
    r = await app_client.patch(
        f"/api/users/{teacher_user.id}/lifecycle",
        json={"lifecycle_status": "invalid_value"},
        headers=auth_headers(super_admin),
    )
    # pydantic regex 422 또는 backend 400
    assert r.status_code in (400, 422)


@pytest.mark.asyncio
async def test_lifecycle_protects_last_super_admin(
    app_client, db_session, super_admin, auth_headers,
):
    # super_admin이 1명뿐 — 본인 lifecycle을 departed로 + disable하면 차단되어야
    r = await app_client.patch(
        f"/api/users/{super_admin.id}/lifecycle",
        json={"lifecycle_status": "departed", "disable_account": True},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_transfer_ownership_changes_owner_and_quota(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    # 또 다른 교사 (후임자)
    from tests.conftest import _create_user
    successor = await _create_user(
        db_session, email="successor@test.local", name="Successor", role="teacher",
    )
    await db_session.commit()

    # teacher_user의 문서 2개
    doc1 = ClassroomDocument(owner_id=teacher_user.id, title="d1", storage_bytes=2_000_000)
    doc2 = ClassroomDocument(owner_id=teacher_user.id, title="d2", storage_bytes=3_000_000)
    teacher_user.used_bytes = 5_000_000
    db_session.add_all([doc1, doc2])
    await db_session.commit()

    r = await app_client.post(
        f"/api/users/{teacher_user.id}/transfer-ownership",
        json={"successor_user_id": successor.id, "types": ["docs"]},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    data = r.json()
    assert data["transferred_count"] == 2
    assert data["transferred_bytes"] == 5_000_000

    # owner 변경 확인
    await db_session.refresh(doc1)
    await db_session.refresh(doc2)
    assert doc1.owner_id == successor.id
    assert doc2.owner_id == successor.id

    # quota 재계산
    await db_session.refresh(teacher_user)
    await db_session.refresh(successor)
    assert teacher_user.used_bytes == 0
    assert successor.used_bytes == 5_000_000


@pytest.mark.asyncio
async def test_transfer_ownership_to_self_rejected(
    app_client, super_admin, teacher_user, auth_headers,
):
    r = await app_client.post(
        f"/api/users/{teacher_user.id}/transfer-ownership",
        json={"successor_user_id": teacher_user.id},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_disable_expired_accounts_only_temporary(db_session, seed_perms):
    """expires_at 도래한 user_type=temporary/substitute만 자동 비활성화."""
    now = datetime.now(timezone.utc)
    past = now - timedelta(days=1)
    future = now + timedelta(days=30)

    from tests.conftest import _create_user

    # 만료된 임시 강사 → 대상
    expired_temp = await _create_user(
        db_session, email="expired@test.local", name="ExpTemp", role="teacher",
    )
    expired_temp.user_type = "temporary"
    expired_temp.expires_at = past

    # 만료 안 된 임시 강사 → 제외
    active_temp = await _create_user(
        db_session, email="active@test.local", name="ActTemp", role="teacher",
    )
    active_temp.user_type = "temporary"
    active_temp.expires_at = future

    # 만료된 regular → 제외 (user_type=regular)
    expired_regular = await _create_user(
        db_session, email="regular@test.local", name="ExpReg", role="teacher",
    )
    expired_regular.user_type = "regular"
    expired_regular.expires_at = past

    await db_session.commit()

    n = await disable_expired_accounts(db_session)
    await db_session.commit()

    # temporary + expired만 비활성화
    assert n == 1

    await db_session.refresh(expired_temp)
    await db_session.refresh(active_temp)
    await db_session.refresh(expired_regular)
    assert expired_temp.status == "disabled"
    assert expired_temp.lifecycle_status == "departed"
    assert active_temp.status != "disabled"
    assert expired_regular.status != "disabled"
