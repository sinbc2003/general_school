"""스토리지 볼륨 lifecycle + 자동 분산 헬퍼 테스트.

검증:
  - 활성/비활성 토글
  - 헬스체크 (mounted/missing)
  - capacity_bytes 자동 채움
  - pick_volume_for_upload: priority + 여유 용량 + 비활성 제외
"""

import pytest
from sqlalchemy import select

from app.models import StorageVolume, User
from app.modules.storage_volumes.router import pick_volume_for_upload


@pytest.mark.asyncio
async def test_volume_active_toggle(
    app_client, super_admin, auth_headers, tmp_path,
):
    r = await app_client.post(
        "/api/storage/volumes",
        json={"name": "togg", "path": str(tmp_path), "capacity_bytes": 1_000_000},
        headers=auth_headers(super_admin),
    )
    vid = r.json()["id"]
    assert r.json()["is_active"] is True

    # 비활성화
    r = await app_client.put(
        f"/api/storage/volumes/{vid}",
        json={"is_active": False},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["is_active"] is False


@pytest.mark.asyncio
async def test_volume_check_updates_status(
    app_client, super_admin, auth_headers, tmp_path,
):
    r = await app_client.post(
        "/api/storage/volumes",
        json={"name": "chk", "path": str(tmp_path)},
        headers=auth_headers(super_admin),
    )
    vid = r.json()["id"]

    r = await app_client.post(
        f"/api/storage/volumes/{vid}/check",
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["last_status"] == "mounted"
    assert r.json()["runtime_total_bytes"] is not None
    assert r.json()["runtime_total_bytes"] > 0


@pytest.mark.asyncio
async def test_volume_create_auto_fills_capacity(
    app_client, super_admin, auth_headers, tmp_path,
):
    """capacity_bytes=0이면 runtime disk total로 자동 채움."""
    r = await app_client.post(
        "/api/storage/volumes",
        json={"name": "auto", "path": str(tmp_path), "capacity_bytes": 0},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    # tmp_path는 실제 디스크 일부라 capacity가 양수로 채워짐
    assert r.json()["capacity_bytes"] > 0


@pytest.mark.asyncio
async def test_volume_delete_removes_row(
    app_client, super_admin, auth_headers, db_session, tmp_path,
):
    r = await app_client.post(
        "/api/storage/volumes",
        json={"name": "del", "path": str(tmp_path)},
        headers=auth_headers(super_admin),
    )
    vid = r.json()["id"]

    r = await app_client.delete(
        f"/api/storage/volumes/{vid}",
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    row = await db_session.get(StorageVolume, vid)
    assert row is None


# ── pick_volume_for_upload 헬퍼 ───────────────────────────


@pytest.mark.asyncio
async def test_pick_volume_returns_active_only(db_session, tmp_path):
    """비활성 볼륨은 선택되지 않음."""
    db_session.add_all([
        StorageVolume(
            name="inactive", path=str(tmp_path), capacity_bytes=1_000_000_000,
            priority=10, is_active=False,
        ),
    ])
    await db_session.commit()

    v = await pick_volume_for_upload(db_session, required_bytes=1000)
    assert v is None


@pytest.mark.asyncio
async def test_pick_volume_returns_lowest_priority(db_session, tmp_path):
    """priority가 낮은 볼륨 우선 선택."""
    # 같은 디렉터리 사용은 unique constraint 충돌 — 다른 sub-path 사용
    sub_a = tmp_path / "vol_a"
    sub_b = tmp_path / "vol_b"
    sub_a.mkdir()
    sub_b.mkdir()

    db_session.add(StorageVolume(
        name="high_prio", path=str(sub_a), capacity_bytes=1_000_000_000,
        priority=10, is_active=True,
    ))
    db_session.add(StorageVolume(
        name="low_prio", path=str(sub_b), capacity_bytes=1_000_000_000,
        priority=200, is_active=True,
    ))
    await db_session.commit()

    v = await pick_volume_for_upload(db_session, required_bytes=1000)
    assert v is not None
    assert v.name == "high_prio"


@pytest.mark.asyncio
async def test_pick_volume_skips_full(db_session, tmp_path):
    """capacity 가득 찬 볼륨은 skip."""
    sub = tmp_path / "full_vol"
    sub.mkdir()

    db_session.add(StorageVolume(
        name="full", path=str(sub),
        capacity_bytes=1000, used_bytes=999, priority=10, is_active=True,
    ))
    await db_session.commit()

    # 2 bytes 요청 → cap(1000) - used(999) = 1 byte 여유 — 부족
    v = await pick_volume_for_upload(db_session, required_bytes=2)
    assert v is None
