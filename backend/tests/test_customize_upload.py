"""카드 배너 이미지 업로드 통합 테스트 (실제 PIL + multipart).

검증:
  - JPG/PNG 정상 업로드 → 자동 압축 + DB.banner_image_url 세팅
  - non-image (text/csv) 거부
  - 5MB 초과 거부
  - 비-소유자 차단
  - 기존 이미지 교체 시 이전 파일 삭제 + quota 환원
"""

import io
from datetime import date

import pytest
from sqlalchemy import select

from app.models import Course, Semester, User


def _make_jpeg_bytes(width: int = 1200, height: int = 800, color=(255, 0, 0)) -> bytes:
    """실제 JPEG binary 생성 — PIL로."""
    from PIL import Image
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _make_png_bytes() -> bytes:
    from PIL import Image
    img = Image.new("RGB", (300, 200), (0, 255, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _make_course(db_session, teacher_user) -> Course:
    sem = Semester(
        name="S", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()
    c = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="X", class_name="1-1", name="X", is_active=True, course_type="subject",
    )
    db_session.add(c)
    await db_session.commit()
    await db_session.refresh(c)
    return c


@pytest.mark.asyncio
async def test_upload_jpeg_compresses_and_saves(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """1200x800 → max 800x500 + JPEG quality 80 압축. DB url 세팅."""
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    c = await _make_course(db_session, teacher_user)
    raw = _make_jpeg_bytes(1200, 800)

    files = {"file": ("banner.jpg", raw, "image/jpeg")}
    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files=files,
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["banner_image_url"].startswith("/storage/classroom/banners/")
    assert data["compressed_bytes"] > 0
    assert data["compressed_bytes"] < len(raw)  # 압축됨

    # 실제 파일 디스크에 있음
    fname = data["banner_image_url"].split("/")[-1]
    assert (tmp_path / fname).exists()

    # DB url 갱신
    await db_session.refresh(c)
    assert c.banner_image_url == data["banner_image_url"]

    # 압축 후 사이즈만큼 quota 차감
    await db_session.refresh(teacher_user)
    assert teacher_user.used_bytes >= data["compressed_bytes"]


@pytest.mark.asyncio
async def test_upload_png_converted_to_jpeg(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """PNG 업로드도 JPEG로 변환 저장."""
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    c = await _make_course(db_session, teacher_user)
    files = {"file": ("banner.png", _make_png_bytes(), "image/png")}
    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files=files,
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    # 항상 .jpg로 저장
    assert r.json()["banner_image_url"].endswith(".jpg")


@pytest.mark.asyncio
async def test_upload_non_image_rejected(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    c = await _make_course(db_session, teacher_user)
    files = {"file": ("doc.txt", b"hello world" * 100, "text/plain")}
    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files=files,
        headers=auth_headers(teacher_user),
    )
    # validate_upload + POLICY_IMAGE에서 거부 (4xx)
    assert 400 <= r.status_code < 500


@pytest.mark.asyncio
async def test_upload_oversized_rejected(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """5MB 초과 거부."""
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    c = await _make_course(db_session, teacher_user)
    # POLICY_IMAGE max_size_bytes를 넘는 큰 이미지 (실제로 매우 큰 JPEG 생성)
    # POLICY_IMAGE는 10MB 한도라 그것 넘는 raw 만들기 — 6000x4000 quality 95
    big = _make_jpeg_bytes(6000, 4000, (0, 0, 255))
    # POLICY_IMAGE를 통과해도 customize의 MAX_IMAGE_BYTES(5MB)에서 거부
    if len(big) < 5 * 1024 * 1024:
        # 보장 안 되니 pad
        big = big + b"x" * (5 * 1024 * 1024)
    files = {"file": ("huge.jpg", big, "image/jpeg")}
    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files=files,
        headers=auth_headers(teacher_user),
    )
    # validate_upload (POLICY_IMAGE 10MB) 또는 MAX_IMAGE_BYTES(5MB) 또는 PIL error
    # 모두 4xx여야
    assert 400 <= r.status_code < 500


@pytest.mark.asyncio
async def test_upload_blocked_for_non_owner(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """다른 교사가 owner 강좌에 업로드 시도 → 403."""
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="other_up@test.local", name="Other Up", role="teacher",
    )
    c = await _make_course(db_session, teacher_user)
    await db_session.commit()

    raw = _make_jpeg_bytes(100, 100)
    files = {"file": ("x.jpg", raw, "image/jpeg")}
    r = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files=files,
        headers=auth_headers(other),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_upload_replaces_old_image_and_refunds_quota(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """두 번째 업로드 시 첫 번째 파일 삭제 + quota 환원 후 새 사이즈 차감."""
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    c = await _make_course(db_session, teacher_user)
    raw1 = _make_jpeg_bytes(1200, 800)
    r1 = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files={"file": ("a.jpg", raw1, "image/jpeg")},
        headers=auth_headers(teacher_user),
    )
    assert r1.status_code == 200
    fname1 = r1.json()["banner_image_url"].split("/")[-1]
    bytes1 = r1.json()["compressed_bytes"]

    # 두 번째 업로드 (다른 색·크기)
    raw2 = _make_jpeg_bytes(600, 400, (0, 200, 0))
    r2 = await app_client.post(
        f"/api/classroom/courses/{c.id}/banner-image",
        files={"file": ("b.jpg", raw2, "image/jpeg")},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200
    fname2 = r2.json()["banner_image_url"].split("/")[-1]
    bytes2 = r2.json()["compressed_bytes"]

    # 첫 번째 파일 삭제됨, 두 번째만 존재
    assert not (tmp_path / fname1).exists()
    assert (tmp_path / fname2).exists()

    # quota는 결과적으로 두 번째 사이즈만 (첫 번째 환원됨)
    await db_session.refresh(teacher_user)
    # 정확한 byte 일치 검증: 두 번째 사이즈만 used에 반영
    # (이미지가 다르면 used가 다른데, 첫 번째 환원 + 두 번째 차감 → 결과는 second만)
    assert teacher_user.used_bytes == bytes2
