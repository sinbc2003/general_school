"""Google OAuth 기본 endpoint 테스트 (외부 호출 없는 부분만).

검증:
  - GET /api/google/me 미연결 시 connected=false
  - DELETE /api/google/me 미연결 상태에서 멱등 200
  - PUT /api/google/config admin 저장 + 암호화 확인
  - GET /api/google/config preview 마스킹

httpx mock이 필요한 OAuth flow (auth-url/callback/Drive proxy)는 별도 통합 테스트.
"""

import pytest
from sqlalchemy import select

from app.models import GoogleConnection
from app.models.setting import SchoolConfig


@pytest.mark.asyncio
async def test_google_me_not_connected_returns_false(
    app_client, teacher_user, auth_headers,
):
    r = await app_client.get("/api/google/me", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    assert r.json()["connected"] is False
    assert r.json()["google_email"] is None


@pytest.mark.asyncio
async def test_google_disconnect_when_not_connected_returns_200(
    app_client, teacher_user, auth_headers,
):
    """연결 안 된 상태에서 disconnect — 멱등 200."""
    r = await app_client.delete("/api/google/me", headers=auth_headers(teacher_user))
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_google_config_set_and_get(
    app_client, db_session, super_admin, auth_headers,
):
    """Client ID/Secret 저장 → SchoolConfig에 암호화 저장 + GET 응답 마스킹."""
    r = await app_client.put(
        "/api/google/config",
        json={
            "client_id": "12345678.apps.googleusercontent.com",
            "client_secret": "GOCSPX-mysecret",
            "redirect_uri": "https://school.example/api/google/callback",
            "enabled": True,
        },
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    # DB에 암호화되어 저장됨
    cid_row = (await db_session.execute(
        select(SchoolConfig).where(SchoolConfig.key == "oauth.google.client_id")
    )).scalar_one_or_none()
    assert cid_row is not None
    assert cid_row.encrypted is True
    assert cid_row.value != "12345678.apps.googleusercontent.com"  # 평문 X

    # GET은 마스킹된 preview
    r = await app_client.get("/api/google/config", headers=auth_headers(super_admin))
    assert r.json()["configured"] is True
    assert r.json()["enabled"] is True
    # preview에 client_id 일부만 + "..."
    preview = r.json()["client_id_preview"]
    assert preview is not None
    assert "..." in preview
    # secret은 노출 안 됨
    assert "GOCSPX" not in str(r.json())


@pytest.mark.asyncio
async def test_google_disconnect_removes_connection_row(
    app_client, db_session, teacher_user, auth_headers,
):
    """연결 row 있는 상태에서 disconnect → DB row 제거."""
    from app.core.encryption import encrypt

    db_session.add(GoogleConnection(
        user_id=teacher_user.id,
        google_email="t@gmail.com",
        refresh_token_encrypted=encrypt("fake_refresh_token"),
        scope="drive.readonly",
    ))
    await db_session.commit()

    r = await app_client.delete("/api/google/me", headers=auth_headers(teacher_user))
    assert r.status_code == 200

    row = (await db_session.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == teacher_user.id)
    )).scalar_one_or_none()
    assert row is None
