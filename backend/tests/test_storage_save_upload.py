"""save_upload_to_volume_async + STORAGE_ROOT env 회귀 테스트.

검증:
  - DEFAULT_STORAGE_ROOT는 settings.STORAGE_ROOT 기반
  - env로 STORAGE_ROOT 바꾸고 files 모듈 재import → 새 값 반영
  - save_upload_to_volume_async:
    - 등록 volume 없으면 (rel, full, None) 반환, DEFAULT_STORAGE_ROOT 하위에 파일
    - 등록 volume 있으면 그 path 사용 + volume_id 반환 + used_bytes 갱신
    - relative_path는 section/filename 형식 (DB에 저장될 path)
  - get_storage_root_with_volume: volume 없으면 (DEFAULT, None) fallback
"""

import importlib
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import StorageVolume


# ── DEFAULT_STORAGE_ROOT ─────────────────────────────────────


def test_default_storage_root_is_path():
    from app.core.files import DEFAULT_STORAGE_ROOT
    assert isinstance(DEFAULT_STORAGE_ROOT, Path)


def test_default_storage_root_reflects_settings(monkeypatch):
    """settings.STORAGE_ROOT 바꾼 후 모듈 재import → 새 path 반영.

    회귀 의도: 누군가 DEFAULT_STORAGE_ROOT를 hard-code하면 env 전환 불가.
    """
    from app.core import config as core_config
    from app.core import files as core_files

    # settings 직접 mutate (Settings 객체) — 안전: 테스트 끝나면 원복
    original = core_config.settings.STORAGE_ROOT
    try:
        core_config.settings.STORAGE_ROOT = "/tmp/test_storage_root_xyz"
        importlib.reload(core_files)
        assert str(core_files.DEFAULT_STORAGE_ROOT) == "/tmp/test_storage_root_xyz"
    finally:
        core_config.settings.STORAGE_ROOT = original
        importlib.reload(core_files)


# ── get_storage_root_with_volume ─────────────────────────────


@pytest.mark.asyncio
async def test_get_storage_root_with_volume_no_volumes_returns_default(db_session):
    from app.core.files import DEFAULT_STORAGE_ROOT, get_storage_root_with_volume
    root, vid = await get_storage_root_with_volume(db_session, required_bytes=100)
    assert root == DEFAULT_STORAGE_ROOT
    assert vid is None


@pytest.mark.asyncio
async def test_get_storage_root_with_volume_picks_active(db_session, tmp_path):
    from app.core.files import get_storage_root_with_volume
    sub = tmp_path / "active_vol"
    sub.mkdir()
    v = StorageVolume(
        name="pick_vol_test", path=str(sub), capacity_bytes=1_000_000_000,
        is_active=True, priority=5,
    )
    db_session.add(v)
    await db_session.commit()
    root, vid = await get_storage_root_with_volume(db_session, required_bytes=100)
    assert root == Path(str(sub))
    assert vid == v.id


# ── save_upload_to_volume_async ──────────────────────────────


@pytest.mark.asyncio
async def test_save_upload_no_volume_writes_to_default(db_session, monkeypatch, tmp_path):
    """등록된 volume 없으면 DEFAULT_STORAGE_ROOT 하위에 저장 + volume_id=None."""
    from app.core import files as core_files

    # DEFAULT_STORAGE_ROOT을 임시 디렉토리로 monkeypatch (격리 — 실제 backend/storage 안 건드림)
    monkeypatch.setattr(core_files, "DEFAULT_STORAGE_ROOT", tmp_path)

    rel, full, vid = await core_files.save_upload_to_volume_async(
        db_session, section="testsec", filename="hello.bin", data=b"hello bytes",
    )
    assert vid is None
    assert rel == "testsec/hello.bin"
    assert full == tmp_path / "testsec" / "hello.bin"
    assert full.read_bytes() == b"hello bytes"


@pytest.mark.asyncio
async def test_save_upload_with_volume_writes_to_volume_path(db_session, tmp_path):
    """active volume 있으면 그 path 사용 + volume_id 반환 + used_bytes 갱신."""
    from app.core.files import save_upload_to_volume_async

    vol_dir = tmp_path / "vol_save"
    vol_dir.mkdir()
    v = StorageVolume(
        name="save_to_vol", path=str(vol_dir), capacity_bytes=1_000_000_000,
        is_active=True, priority=5, used_bytes=0,
    )
    db_session.add(v)
    await db_session.commit()
    vid_before = v.id

    data = b"payload data 123"
    rel, full, vid = await save_upload_to_volume_async(
        db_session, section="docs", filename="x.txt", data=data,
    )

    assert vid == vid_before
    assert rel == "docs/x.txt"
    assert full == vol_dir / "docs" / "x.txt"
    assert full.read_bytes() == data

    # used_bytes 갱신 검증
    await db_session.commit()
    refreshed = (await db_session.execute(
        select(StorageVolume).where(StorageVolume.id == vid_before)
    )).scalar_one()
    assert refreshed.used_bytes == len(data)


@pytest.mark.asyncio
async def test_save_upload_relative_path_uses_section_filename_format(
    db_session, monkeypatch, tmp_path,
):
    """relative_path는 section/filename 포맷 — _GUARDS 호환 보장."""
    from app.core import files as core_files

    monkeypatch.setattr(core_files, "DEFAULT_STORAGE_ROOT", tmp_path)
    rel, _, _ = await core_files.save_upload_to_volume_async(
        db_session, section="artifacts/42", filename="abc.pdf", data=b"x",
    )
    assert rel == "artifacts/42/abc.pdf"


@pytest.mark.asyncio
async def test_save_upload_creates_section_subdir(db_session, monkeypatch, tmp_path):
    """section 디렉토리가 없어도 자동 생성."""
    from app.core import files as core_files

    monkeypatch.setattr(core_files, "DEFAULT_STORAGE_ROOT", tmp_path)
    section_dir = tmp_path / "nested" / "deep"
    assert not section_dir.exists()
    await core_files.save_upload_to_volume_async(
        db_session, section="nested/deep", filename="z.bin", data=b"deep",
    )
    assert section_dir.exists()
    assert (section_dir / "z.bin").read_bytes() == b"deep"


@pytest.mark.asyncio
async def test_save_upload_empty_data_ok(db_session, monkeypatch, tmp_path):
    """0-byte 파일도 OK (실패 안 함)."""
    from app.core import files as core_files

    monkeypatch.setattr(core_files, "DEFAULT_STORAGE_ROOT", tmp_path)
    rel, full, vid = await core_files.save_upload_to_volume_async(
        db_session, section="empty", filename="zero.bin", data=b"",
    )
    assert full.exists()
    assert full.read_bytes() == b""
    assert vid is None
