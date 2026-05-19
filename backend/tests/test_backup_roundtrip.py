"""전체 백업 export ↔ restore 라운드트립 테스트.

`app/services/backup.py`의 `export_all` + `restore_all`을 직접 검증한다.

왜 이게 critical:
  - 학교가 장비 이관할 때 사용. 라운드트립 깨지면 데이터 손실 → 재앙
  - DB 모든 테이블을 동적으로 수집하므로 새 모델 추가 시 자동 포함되는지 확인
  - destructive 작업 (모든 행 wipe → INSERT) — 트랜잭션 무결성 중요
  - 잘못된 ZIP 입력에 대한 에러 처리 (manifest 누락, BadZip 등)

테스트 시나리오:
  - 사용자 N명 생성 → export → restore → 동일한 N명 복원
  - confirm=False면 데이터 안 건드림 (preview only)
  - 유효하지 않은 ZIP → RestoreError
  - manifest.json 누락 → RestoreError
"""

import io
import json
import zipfile

import pytest
from sqlalchemy import func, select

from app.services.backup import RestoreError, export_all, restore_all


pytestmark = pytest.mark.security


# ── round-trip ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_then_restore_preserves_users(
    db_session, super_admin, teacher_user, student_user,
):
    """사용자 3명 export → restore → 동일한 3명 복원."""
    from app.models.user import User

    # Arrange: 사용자 3명 이미 있음 (fixture로) + 1명 추가
    from tests.conftest import _create_user
    extra = await _create_user(
        db_session, email="extra@test.local", name="Extra Teacher",
        role="teacher",
    )
    await db_session.commit()

    before_count = (await db_session.execute(select(func.count(User.id)))).scalar()
    assert before_count == 4  # super, da X, teacher, student, extra...
    # 주의: designated_admin fixture는 호출 안 했으므로 4명만

    # Act: export
    zip_bytes = await export_all(db_session)
    assert len(zip_bytes) > 100  # 빈 zip이 아님

    # ZIP 내용 검증
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "data.json" in names
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["format_version"] == 1
        assert manifest["total_rows"] >= 4
        assert "users" in manifest["table_names"]

    # 사용자 데이터 wipe (restore 시 자동 wipe되지만 검증을 위해 명시)
    # → restore가 wipe + insert를 처리하므로 그냥 호출
    result = await restore_all(db_session, zip_bytes, confirm=True)
    await db_session.commit()

    # Assert
    assert result["applied"] is True
    after_count = (await db_session.execute(select(func.count(User.id)))).scalar()
    assert after_count == before_count  # 동일

    # extra user가 복원됐는지 확인
    restored_extra = (await db_session.execute(
        select(User).where(User.email == "extra@test.local")
    )).scalar_one_or_none()
    assert restored_extra is not None
    assert restored_extra.name == "Extra Teacher"


@pytest.mark.asyncio
async def test_restore_preview_does_not_apply(
    db_session, super_admin, teacher_user,
):
    """confirm=False는 manifest 검증만, 데이터 안 건드림."""
    from app.models.user import User

    zip_bytes = await export_all(db_session)
    before_count = (await db_session.execute(select(func.count(User.id)))).scalar()

    # 사용자 1명 더 추가 (export 이후)
    from tests.conftest import _create_user
    await _create_user(
        db_session, email="after_export@test.local", name="After",
        role="teacher",
    )
    await db_session.commit()
    mid_count = (await db_session.execute(select(func.count(User.id)))).scalar()
    assert mid_count == before_count + 1

    # Preview (confirm=False)
    result = await restore_all(db_session, zip_bytes, confirm=False)
    await db_session.commit()

    assert result["applied"] is False
    # 데이터 안 건드림 — 사용자 수 그대로
    after_count = (await db_session.execute(select(func.count(User.id)))).scalar()
    assert after_count == mid_count  # 변동 없음


# ── 에러 처리 ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_restore_invalid_zip_raises_error(db_session, super_admin):
    """유효하지 않은 ZIP 바이트는 RestoreError."""
    with pytest.raises(RestoreError) as exc:
        await restore_all(db_session, b"not a zip file", confirm=False)
    assert "유효하지 않은 ZIP" in str(exc.value)


@pytest.mark.asyncio
async def test_restore_missing_manifest_raises_error(db_session, super_admin):
    """manifest.json 없는 ZIP은 RestoreError."""
    # 빈 zip 생성
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("readme.txt", "not a backup")

    with pytest.raises(RestoreError) as exc:
        await restore_all(db_session, buf.getvalue(), confirm=False)
    assert "manifest" in str(exc.value).lower() or "data.json" in str(exc.value).lower()


# ── manifest warning (스키마 불일치) ───────────────────────


@pytest.mark.asyncio
async def test_restore_warns_on_extra_table_in_backup(
    db_session, super_admin,
):
    """백업에만 있고 현재 모델에 없는 테이블은 warning에 포함."""
    # 정상 export
    zip_bytes = await export_all(db_session)

    # 가짜 테이블 추가
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf_in:
        manifest = json.loads(zf_in.read("manifest.json"))
        data = json.loads(zf_in.read("data.json"))

    data["ghost_table"] = [{"id": 1, "name": "ghost"}]

    new_buf = io.BytesIO()
    with zipfile.ZipFile(new_buf, "w", zipfile.ZIP_DEFLATED) as zf_out:
        zf_out.writestr("manifest.json", json.dumps(manifest))
        zf_out.writestr("data.json", json.dumps(data))

    result = await restore_all(db_session, new_buf.getvalue(), confirm=False)
    assert any("백업에만 있는" in w or "ghost_table" in w for w in result["warnings"])


@pytest.mark.asyncio
async def test_restore_includes_all_metadata_tables(
    db_session, super_admin,
):
    """export 시 Base.metadata.sorted_tables 모든 테이블이 포함됨.

    새 모델 추가 시 자동 포함 보장 — `__init__.py` import 규칙 검증.
    """
    from app.core.database import Base

    zip_bytes = await export_all(db_session)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        data = json.loads(zf.read("data.json"))

    expected_tables = {t.name for t in Base.metadata.sorted_tables}
    backup_tables = set(manifest["table_names"])
    assert expected_tables == backup_tables

    # data.json도 모든 테이블 key 포함
    assert expected_tables.issubset(set(data.keys()))
