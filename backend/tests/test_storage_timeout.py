"""core/files.py timeout 회귀 테스트.

검증 대상 (위험 2 — NFS / 외장 SSD 마운트 끊김 보호):
  - write_bytes_async, read_bytes_async, ensure_dir_async, unlink_async 모두
    asyncio.to_thread + asyncio.wait_for 적용
  - 짧은 timeout 줘서 StorageUnavailable 발생 확인
  - StorageUnavailable은 OSError 상속 (기존 except OSError 호환)
  - FileNotFoundError는 wrapping 안 됨 (정상 OS 에러 전파)
  - 정상 경로는 OK
"""

import asyncio
from pathlib import Path

import pytest

from app.core.files import (
    DEFAULT_IO_TIMEOUT_SEC,
    DEFAULT_META_TIMEOUT_SEC,
    StorageUnavailable,
    ensure_dir_async,
    read_bytes_async,
    unlink_async,
    write_bytes_async,
)


# ── 정상 경로 (smoke) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_write_then_read_bytes_async_roundtrip(tmp_path):
    p = tmp_path / "hello.bin"
    await write_bytes_async(p, b"hello world")
    data = await read_bytes_async(p)
    assert data == b"hello world"


@pytest.mark.asyncio
async def test_ensure_dir_async_creates_nested(tmp_path):
    nested = tmp_path / "a" / "b" / "c"
    await ensure_dir_async(nested)
    assert nested.exists() and nested.is_dir()


@pytest.mark.asyncio
async def test_ensure_dir_async_idempotent(tmp_path):
    p = tmp_path / "twice"
    await ensure_dir_async(p)
    await ensure_dir_async(p)  # exist_ok=True 보장
    assert p.exists()


@pytest.mark.asyncio
async def test_unlink_async_removes_file(tmp_path):
    p = tmp_path / "kill.bin"
    p.write_bytes(b"x")
    assert p.exists()
    await unlink_async(p)
    assert not p.exists()


@pytest.mark.asyncio
async def test_unlink_async_missing_ok_default(tmp_path):
    p = tmp_path / "never_existed.bin"
    # missing_ok 기본 True → 에러 없이 통과
    await unlink_async(p)


@pytest.mark.asyncio
async def test_unlink_async_missing_not_ok_raises(tmp_path):
    p = tmp_path / "never_existed.bin"
    with pytest.raises(FileNotFoundError):
        await unlink_async(p, missing_ok=False)


# ── StorageUnavailable 상속 / 호환성 ─────────────────────────


def test_storage_unavailable_is_oserror_subclass():
    """기존 except OSError 블록에서도 잡혀야 함 (호환)."""
    assert issubclass(StorageUnavailable, OSError)


def test_storage_unavailable_can_be_caught_as_oserror():
    """실제로 raise → except OSError로 잡힘."""
    try:
        raise StorageUnavailable("test")
    except OSError as exc:
        assert isinstance(exc, StorageUnavailable)
    else:
        pytest.fail("StorageUnavailable was not caught as OSError")


# ── timeout 발화 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_write_bytes_timeout_raises_storage_unavailable(monkeypatch, tmp_path):
    """asyncio.to_thread가 매우 느린 경우 → StorageUnavailable.

    `asyncio.to_thread`를 mock으로 교체하여 timeout보다 더 오래 걸리는 coroutine 반환.
    """
    async def slow_thread(func, *args, **kwargs):
        await asyncio.sleep(2.0)
        return func(*args, **kwargs)

    monkeypatch.setattr("app.core.files.asyncio.to_thread", slow_thread)
    with pytest.raises(StorageUnavailable):
        await write_bytes_async(tmp_path / "x.bin", b"data", timeout=0.05)


@pytest.mark.asyncio
async def test_read_bytes_timeout_raises_storage_unavailable(monkeypatch, tmp_path):
    p = tmp_path / "y.bin"
    p.write_bytes(b"hi")

    async def slow_thread(func, *args, **kwargs):
        await asyncio.sleep(2.0)
        return func(*args, **kwargs)

    monkeypatch.setattr("app.core.files.asyncio.to_thread", slow_thread)
    with pytest.raises(StorageUnavailable):
        await read_bytes_async(p, timeout=0.05)


@pytest.mark.asyncio
async def test_ensure_dir_timeout_raises_storage_unavailable(monkeypatch, tmp_path):
    async def slow_thread(func, *args, **kwargs):
        await asyncio.sleep(2.0)
        return func(*args, **kwargs)

    monkeypatch.setattr("app.core.files.asyncio.to_thread", slow_thread)
    with pytest.raises(StorageUnavailable):
        await ensure_dir_async(tmp_path / "z", timeout=0.05)


@pytest.mark.asyncio
async def test_unlink_timeout_raises_storage_unavailable(monkeypatch, tmp_path):
    p = tmp_path / "u.bin"
    p.write_bytes(b"x")

    async def slow_thread(func, *args, **kwargs):
        await asyncio.sleep(2.0)
        return func(*args, **kwargs)

    monkeypatch.setattr("app.core.files.asyncio.to_thread", slow_thread)
    with pytest.raises(StorageUnavailable):
        await unlink_async(p, timeout=0.05)


@pytest.mark.asyncio
async def test_storage_unavailable_caught_as_oserror_in_router_pattern(
    monkeypatch, tmp_path,
):
    """라우터에서 except OSError로 잡힌다 — 호환성 회귀."""
    async def slow_thread(func, *args, **kwargs):
        await asyncio.sleep(2.0)
        return func(*args, **kwargs)

    monkeypatch.setattr("app.core.files.asyncio.to_thread", slow_thread)
    caught = None
    try:
        await write_bytes_async(tmp_path / "a", b"x", timeout=0.05)
    except OSError as exc:
        caught = exc
    assert caught is not None
    assert isinstance(caught, StorageUnavailable)


# ── timeout 미발화 + 정상 OS 에러 전파 ───────────────────────


@pytest.mark.asyncio
async def test_read_bytes_filenotfound_not_wrapped(tmp_path):
    """FileNotFoundError는 그대로 전파 (wrapping 안 함) — 정상 OS 에러."""
    missing = tmp_path / "does_not_exist.bin"
    with pytest.raises(FileNotFoundError):
        await read_bytes_async(missing)


@pytest.mark.asyncio
async def test_write_bytes_default_timeout_is_30():
    """기본 timeout 상수 값 회귀 — 변경 시 의도적이어야 함."""
    assert DEFAULT_IO_TIMEOUT_SEC == 30.0


@pytest.mark.asyncio
async def test_meta_default_timeout_is_5():
    assert DEFAULT_META_TIMEOUT_SEC == 5.0
