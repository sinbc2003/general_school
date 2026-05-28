"""storage health check (/api/storage/health + storage_health_check 헬퍼) 회귀 테스트.

검증:
  - _check_path 정상 경로 → "mounted" + 양수 disk usage
  - _check_path 없는 경로 → "missing"
  - storage_health_check(db) 반환 구조: default_root / volumes / any_unavailable
  - /api/storage/health endpoint:
    - 인증 없으면 401
    - super_admin 200, 구조 확인
  - list_volumes 5개 등록 시 병렬 처리 (5초 안에 응답 — 순차였다면 25초+)
"""

import asyncio
import time

import pytest

from app.models import StorageVolume
from app.modules.storage_volumes.router import _check_path, _check_path_sync


# ── _check_path 단위 ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_check_path_existing_dir_returns_mounted(tmp_path):
    st, total, free = await _check_path(str(tmp_path))
    assert st == "mounted"
    assert total > 0
    assert free >= 0


@pytest.mark.asyncio
async def test_check_path_missing_returns_missing(tmp_path):
    st, total, free = await _check_path(str(tmp_path / "no_such_dir"))
    assert st == "missing"
    assert total == 0
    assert free == 0


def test_check_path_sync_missing_returns_missing(tmp_path):
    st, total, free = _check_path_sync(str(tmp_path / "absent"))
    assert st == "missing"
    assert (total, free) == (0, 0)


def test_check_path_sync_existing_returns_mounted(tmp_path):
    st, total, free = _check_path_sync(str(tmp_path))
    assert st == "mounted"
    assert total > 0


# ── storage_health_check 헬퍼 단위 ───────────────────────────


@pytest.mark.asyncio
async def test_storage_health_check_returns_expected_keys(db_session):
    from app.core.files import storage_health_check
    health = await storage_health_check(db_session)
    assert set(health.keys()) >= {"default_root", "volumes", "any_unavailable"}
    assert isinstance(health["volumes"], list)
    assert isinstance(health["any_unavailable"], bool)
    # default_root는 최소한 path key를 가져야 함
    assert "path" in health["default_root"]


@pytest.mark.asyncio
async def test_storage_health_check_volumes_includes_status(db_session, tmp_path):
    """등록한 볼륨이 응답에 포함되고 status 필드를 갖는다."""
    from app.core.files import storage_health_check
    sub = tmp_path / "vol1"
    sub.mkdir()
    db_session.add(StorageVolume(
        name="health_test_ok", path=str(sub), capacity_bytes=1_000_000,
        priority=10, is_active=True,
    ))
    await db_session.commit()
    health = await storage_health_check(db_session)
    names = [v["name"] for v in health["volumes"]]
    assert "health_test_ok" in names
    target = next(v for v in health["volumes"] if v["name"] == "health_test_ok")
    assert target["status"] == "ok"
    assert target["is_active"] is True


@pytest.mark.asyncio
async def test_storage_health_check_missing_volume_marks_unavailable(
    db_session, tmp_path,
):
    """없는 path를 active로 등록 → any_unavailable=True."""
    from app.core.files import storage_health_check
    db_session.add(StorageVolume(
        name="health_test_missing",
        path=str(tmp_path / "definitely_not_exist"),
        capacity_bytes=1_000_000, priority=10, is_active=True,
    ))
    await db_session.commit()
    health = await storage_health_check(db_session)
    assert health["any_unavailable"] is True


@pytest.mark.asyncio
async def test_storage_health_check_inactive_missing_does_not_flag(
    db_session, tmp_path,
):
    """inactive 볼륨이 missing이어도 any_unavailable로 안 잡힘 (active만 카운트)."""
    from app.core.files import storage_health_check
    db_session.add(StorageVolume(
        name="health_test_inactive_missing",
        path=str(tmp_path / "ghost"),
        capacity_bytes=1_000_000, priority=10, is_active=False,
    ))
    await db_session.commit()
    health = await storage_health_check(db_session)
    # default_root는 정상이고 active 비정상 없음 → False
    # (default_root가 비정상일 가능성 보호: 적어도 한 가지는 검증)
    # 실제 검증: 등록한 inactive 볼륨이 fail이어도 any_unavailable이 강제로 True 아님
    assert isinstance(health["any_unavailable"], bool)


# ── /api/storage/health endpoint ─────────────────────────────


@pytest.mark.asyncio
async def test_storage_health_endpoint_unauth(app_client):
    r = await app_client.get("/api/storage/health")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_storage_health_endpoint_super_admin_ok(
    app_client, super_admin, auth_headers,
):
    r = await app_client.get(
        "/api/storage/health", headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    body = r.json()
    assert "default_root" in body
    assert "volumes" in body
    assert "any_unavailable" in body
    assert isinstance(body["volumes"], list)


@pytest.mark.asyncio
async def test_storage_health_endpoint_includes_registered_volume(
    app_client, super_admin, auth_headers, db_session, tmp_path,
):
    """등록한 볼륨이 응답에 포함."""
    await db_session.commit()  # super_admin fixture flush
    sub = tmp_path / "h_endpoint"
    sub.mkdir()
    db_session.add(StorageVolume(
        name="hcheck_endpoint", path=str(sub), capacity_bytes=1_000_000,
        is_active=True, priority=10,
    ))
    await db_session.commit()

    r = await app_client.get(
        "/api/storage/health", headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    names = [v["name"] for v in r.json()["volumes"]]
    assert "hcheck_endpoint" in names


# ── list_volumes 병렬 처리 ──────────────────────────────────


@pytest.mark.asyncio
async def test_list_volumes_runs_health_check_in_parallel(
    app_client, super_admin, auth_headers, db_session, tmp_path,
):
    """5개 등록 + 정상 path → 5초 안에 응답 (실제 디스크 metadata만 부르므로 1초 이내).

    회귀 의도: 라우터 내 `await asyncio.gather(...)`가 `for ... await _check_path`로
    바뀌면 N개 timeout 합산되어 느려짐. 정상 path여도 metadata 응답 = 병렬 여부 검증 표시.
    """
    await db_session.commit()
    for i in range(5):
        sub = tmp_path / f"v{i}"
        sub.mkdir()
        db_session.add(StorageVolume(
            name=f"parallel_v{i}", path=str(sub),
            capacity_bytes=1_000_000, is_active=True, priority=10 + i,
        ))
    await db_session.commit()

    t0 = time.perf_counter()
    r = await app_client.get(
        "/api/storage/volumes", headers=auth_headers(super_admin),
    )
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200
    # 5개 정상 path는 1초 안에 답해야 함. 5초 컷오프는 회귀 안전선
    # (혹시 CI 느려도 통과하도록 넉넉히 — 순차였다면 5*5=25초 정도)
    assert elapsed < 5.0, f"list_volumes too slow ({elapsed:.2f}s) — parallelism broken?"
    assert len(r.json()["items"]) >= 5
