"""Google Drive export endpoint (httpx mock).

검증:
  - POST /api/google/export/docs/{id}: HTML → Drive upload (정상)
  - POST /api/google/export/sheets/{id}: XLSX → Drive upload
  - 미연결 사용자 → 401
  - 본인 문서 아니면 403
"""

import pytest
from sqlalchemy import select

from app.core.encryption import encrypt
from app.models import ClassroomDocument, ClassroomSheet, GoogleConnection
from app.models.setting import SchoolConfig


async def _seed_oauth_and_connect(db_session, user):
    """OAuth 설정 + 해당 user의 GoogleConnection."""
    db_session.add_all([
        SchoolConfig(key="oauth.google.client_id", value=encrypt("cid"), encrypted=True),
        SchoolConfig(key="oauth.google.client_secret", value=encrypt("cs"), encrypted=True),
        SchoolConfig(key="oauth.google.redirect_uri", value="https://x/cb", encrypted=False),
        SchoolConfig(key="oauth.google.enabled", value="true", encrypted=False),
        GoogleConnection(
            user_id=user.id,
            google_email=f"{user.email}",
            refresh_token_encrypted=encrypt("fake-refresh"),
            scope="drive.file",
        ),
    ])
    await db_session.commit()


class _MockResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _MockHttpxClient:
    """token refresh + Drive multipart upload 양쪽 처리."""
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        if "oauth2.googleapis.com/token" in url:
            return _MockResponse(200, {"access_token": "fake-access"})
        if "upload/drive/v3/files" in url:
            return _MockResponse(200, {
                "id": "FAKE_DRIVE_FILE_ID",
                "name": "uploaded",
                "mimeType": "application/vnd.google-apps.document",
            })
        return _MockResponse(404, {})

    async def get(self, url, **kwargs):
        return _MockResponse(404, {})

    async def request(self, method, url, **kwargs):
        # _google_http는 client.request(method, url)로 호출 → method별로 .post/.get 위임.
        if method.upper() == "POST":
            return await self.post(url, **kwargs)
        if method.upper() == "GET":
            return await self.get(url, **kwargs)
        return _MockResponse(404, {})


@pytest.mark.asyncio
async def test_export_doc_to_drive(
    app_client, db_session, teacher_user, auth_headers, monkeypatch,
):
    await _seed_oauth_and_connect(db_session, teacher_user)
    doc = ClassroomDocument(
        owner_id=teacher_user.id, title="My Doc", plain_text="Hello world",
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    import app.modules.google_integration.router as goog_router
    import app.modules.google_integration.export as goog_export
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _MockHttpxClient)
    monkeypatch.setattr(goog_export.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.post(
        f"/api/google/export/docs/{doc.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["drive_file_id"] == "FAKE_DRIVE_FILE_ID"
    assert "docs.google.com/document" in data["view_url"]


@pytest.mark.asyncio
async def test_export_doc_blocks_non_owner(
    app_client, db_session, teacher_user, student_user, auth_headers, monkeypatch,
):
    await _seed_oauth_and_connect(db_session, student_user)
    doc = ClassroomDocument(owner_id=teacher_user.id, title="teacher's doc")
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    import app.modules.google_integration.export as goog_export
    monkeypatch.setattr(goog_export.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.post(
        f"/api/google/export/docs/{doc.id}",
        headers=auth_headers(student_user),  # student는 not owner
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_export_doc_without_connection_returns_401(
    app_client, db_session, teacher_user, auth_headers, monkeypatch,
):
    """GoogleConnection 없으면 401."""
    # OAuth 설정만 (GoogleConnection 없음)
    db_session.add_all([
        SchoolConfig(key="oauth.google.client_id", value=encrypt("cid"), encrypted=True),
        SchoolConfig(key="oauth.google.client_secret", value=encrypt("cs"), encrypted=True),
        SchoolConfig(key="oauth.google.redirect_uri", value="https://x/cb", encrypted=False),
        SchoolConfig(key="oauth.google.enabled", value="true", encrypted=False),
    ])
    doc = ClassroomDocument(owner_id=teacher_user.id, title="No Conn")
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    r = await app_client.post(
        f"/api/google/export/docs/{doc.id}",
        headers=auth_headers(teacher_user),
    )
    # 401 (Google 계정 미연결)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_export_sheet_to_drive(
    app_client, db_session, teacher_user, auth_headers, monkeypatch,
):
    await _seed_oauth_and_connect(db_session, teacher_user)
    sheet = ClassroomSheet(
        owner_id=teacher_user.id, title="My Sheet",
    )
    db_session.add(sheet)
    await db_session.commit()
    await db_session.refresh(sheet)

    import app.modules.google_integration.router as goog_router
    import app.modules.google_integration.export as goog_export
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _MockHttpxClient)
    monkeypatch.setattr(goog_export.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.post(
        f"/api/google/export/sheets/{sheet.id}",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    assert r.json()["drive_file_id"] == "FAKE_DRIVE_FILE_ID"
    assert "spreadsheets.d" in r.json()["view_url"] or "spreadsheets" in r.json()["view_url"]


@pytest.mark.asyncio
async def test_export_nonexistent_doc_404(
    app_client, db_session, teacher_user, auth_headers, monkeypatch,
):
    await _seed_oauth_and_connect(db_session, teacher_user)

    import app.modules.google_integration.export as goog_export
    monkeypatch.setattr(goog_export.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.post(
        "/api/google/export/docs/999999",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404
