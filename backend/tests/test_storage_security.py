"""파일 저장소(`/storage`) 익명 노출 방지 회귀 테스트.

이전에 `app.mount("/storage", StaticFiles(...))`로 인해 학생 비공개 산출물·
백업 ZIP까지 익명 GET이 200 OK였음. 이제:
  - /storage/* 직접 접근 → 404 (mount 제거됨)
  - /storage/branding/* → 200 (익명 favicon만 허용)
  - /api/files/storage/* → 401 (인증 필수)
  - 인증 + DB orphan file_url → 404 (path 추측 차단)
  - 학생이 다른 학생 비공개 산출물 접근 → 403
  - 학생이 다른 학생 공개 산출물 접근 → 200

회귀 사고:
  - 누군가 main.py에 `app.mount("/storage", ...)` 재추가하면 즉시 fail
  - serve_storage의 권한 가드를 깨면 fail
"""

from pathlib import Path

import pytest

from app.models.student_self import StudentArtifact


pytestmark = pytest.mark.security

# storage 루트 (테스트 격리 위해 main.py와 동일 경로 사용)
STORAGE_ROOT = Path(__file__).resolve().parents[1] / "storage"


# ── helpers ────────────────────────────────────────────────


def _write_storage_file(rel_path: str, content: str = "test") -> Path:
    full = STORAGE_ROOT / rel_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content)
    return full


def _cleanup(path: Path) -> None:
    if path.exists():
        path.unlink()
    # 빈 디렉토리 정리
    p = path.parent
    while p != STORAGE_ROOT and p.exists() and not any(p.iterdir()):
        p.rmdir()
        p = p.parent


async def _make_artifact(db, *, user_id, is_public, file_rel="artifact_test.txt"):
    """DB에 artifact row + 실제 파일 생성. cleanup은 호출자 책임."""
    rel_path = f"artifacts/{user_id}/{file_rel}"
    full = _write_storage_file(rel_path, "비공개 본문" if not is_public else "공개 본문")
    a = StudentArtifact(
        student_id=user_id,
        title="test",
        category="other",
        file_url=f"/storage/{rel_path}",
        file_name=file_rel,
        is_public=is_public,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a, full


# ── 익명 접근 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anonymous_storage_direct_path_blocked(app_client):
    """이전 mount 경로 `/storage/artifacts/...`는 404 (mount 제거됨)."""
    # 가짜 파일 생성
    full = _write_storage_file("artifacts/9999/secret.txt", "leak target")
    try:
        r = await app_client.get("/storage/artifacts/9999/secret.txt")
        assert r.status_code == 404
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_anonymous_api_files_storage_blocked(app_client):
    """`/api/files/storage/...`는 인증 필요 → 401."""
    full = _write_storage_file("artifacts/9999/secret.txt", "leak target")
    try:
        r = await app_client.get("/api/files/storage/artifacts/9999/secret.txt")
        assert r.status_code == 401
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_branding_remains_public(app_client):
    """favicon은 layout SSR에서 익명 접근 필요 → 200."""
    full = _write_storage_file("branding/test_favicon.txt", "fav")
    try:
        r = await app_client.get("/storage/branding/test_favicon.txt")
        assert r.status_code == 200
        assert r.text == "fav"
    finally:
        _cleanup(full)


# ── 인증 + 권한 가드 ──────────────────────────────────────


@pytest.mark.asyncio
async def test_authenticated_orphan_file_returns_404(
    app_client, db_session, student_user, auth_headers,
):
    """파일이 디스크에 있지만 DB에 file_url 매칭 없으면 404 (path 추측 차단)."""
    full = _write_storage_file("artifacts/9999/orphan.txt", "ghost")
    try:
        r = await app_client.get(
            "/api/files/storage/artifacts/9999/orphan.txt",
            headers=auth_headers(student_user),
        )
        assert r.status_code == 404
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_owner_can_download_own_private_artifact(
    app_client, db_session, student_user, auth_headers,
):
    """본인 비공개 artifact는 다운로드 가능."""
    a, full = await _make_artifact(
        db_session, user_id=student_user.id, is_public=False, file_rel="mine.txt",
    )
    try:
        r = await app_client.get(
            f"/api/files{a.file_url}", headers=auth_headers(student_user),
        )
        assert r.status_code == 200
        assert "비공개 본문" in r.text
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_other_student_cannot_download_private(
    app_client, db_session, student_user, auth_headers, seed_perms,
):
    """다른 학생의 비공개 artifact 접근 → 403."""
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="victim@t.local", name="Victim", role="student",
    )
    a, full = await _make_artifact(
        db_session, user_id=other.id, is_public=False, file_rel="victim.txt",
    )
    try:
        r = await app_client.get(
            f"/api/files{a.file_url}", headers=auth_headers(student_user),
        )
        assert r.status_code == 403
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_other_student_can_download_public_artifact(
    app_client, db_session, student_user, auth_headers, seed_perms,
):
    """공개 artifact는 다른 인증 사용자도 OK (학생 산출물 갤러리)."""
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="creator@t.local", name="Creator", role="student",
    )
    a, full = await _make_artifact(
        db_session, user_id=other.id, is_public=True, file_rel="public.txt",
    )
    try:
        r = await app_client.get(
            f"/api/files{a.file_url}", headers=auth_headers(student_user),
        )
        assert r.status_code == 200
    finally:
        _cleanup(full)


@pytest.mark.asyncio
async def test_super_admin_can_download_any_artifact(
    app_client, db_session, super_admin, auth_headers, seed_perms,
):
    """super_admin은 비공개 artifact도 다운로드 가능."""
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="any@t.local", name="Any", role="student",
    )
    a, full = await _make_artifact(
        db_session, user_id=other.id, is_public=False, file_rel="any.txt",
    )
    try:
        r = await app_client.get(
            f"/api/files{a.file_url}", headers=auth_headers(super_admin),
        )
        assert r.status_code == 200
    finally:
        _cleanup(full)


# ── path traversal ───────────────────────────────────────


@pytest.mark.asyncio
async def test_path_traversal_blocked(app_client, student_user, auth_headers):
    """`..`로 storage 외부 접근 시도 차단."""
    r = await app_client.get(
        "/api/files/storage/../etc/passwd",
        headers=auth_headers(student_user),
    )
    # 400 (정규화 단계 차단) 또는 404 (파일 없음). 어느 쪽이든 200 아니어야 함.
    assert r.status_code in (400, 404)


@pytest.mark.asyncio
async def test_absolute_path_blocked(app_client, student_user, auth_headers):
    """절대 경로 시도 차단."""
    # FastAPI path param이 /로 시작 못 하지만, 우회 시도
    r = await app_client.get(
        "/api/files/storage//etc/passwd",
        headers=auth_headers(student_user),
    )
    assert r.status_code in (400, 404)
