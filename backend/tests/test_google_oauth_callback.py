"""Google OAuth callback + auth-url 흐름 (httpx mock).

검증:
  - /auth-url: Google 인증 URL 정상 발급 + state DB 저장
  - /callback: 정상 code 교환 → refresh_token 암호화 저장 + GoogleConnection 생성
  - /callback: refresh_token 미수신 시 400
  - /callback: 토큰 교환 실패 시 400
  - /callback: 같은 google_email로 다른 사용자 이미 연결됐을 때 409

mock 패턴: httpx.AsyncClient.post / .get을 monkeypatch.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy import select

from app.core.encryption import encrypt
from app.models import GoogleConnection
from app.models.setting import SchoolConfig


async def _seed_oauth_config(db_session):
    """OAuth client 설정 시드."""
    db_session.add_all([
        SchoolConfig(key="oauth.google.client_id", value=encrypt("test-cid"), encrypted=True),
        SchoolConfig(key="oauth.google.client_secret", value=encrypt("test-cs"), encrypted=True),
        SchoolConfig(key="oauth.google.redirect_uri", value="https://x/cb", encrypted=False),
        SchoolConfig(key="oauth.google.enabled", value="true", encrypted=False),
    ])
    await db_session.commit()


class _MockResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _MockHttpxClient:
    """httpx.AsyncClient mock — context manager + post/get."""
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, **kwargs):
        # token exchange 결과
        if "oauth2.googleapis.com/token" in url:
            return _MockResponse(200, {
                "access_token": "fake-access",
                "refresh_token": "fake-refresh",
                "scope": "drive.readonly",
            })
        return _MockResponse(404, {})

    async def get(self, url, **kwargs):
        # userinfo
        if "oauth2/v3/userinfo" in url:
            return _MockResponse(200, {"email": "teacher@gmail.com", "name": "T"})
        return _MockResponse(404, {})


@pytest.mark.asyncio
async def test_auth_url_generates_state_and_url(
    app_client, db_session, teacher_user, auth_headers,
):
    await _seed_oauth_config(db_session)

    r = await app_client.get("/api/google/auth-url", headers=auth_headers(teacher_user))
    assert r.status_code == 200
    url = r.json()["url"]
    assert "accounts.google.com/o/oauth2" in url
    assert "state=" in url
    assert "access_type=offline" in url

    # DB에 state 저장됐는지
    state_keys = (await db_session.execute(
        select(SchoolConfig).where(SchoolConfig.key.startswith("oauth.google.state."))
    )).scalars().all()
    assert len(state_keys) >= 1


@pytest.mark.asyncio
async def test_callback_creates_google_connection(
    app_client, db_session, teacher_user, monkeypatch,
):
    """정상 flow: callback이 token 교환 + GoogleConnection 저장."""
    await _seed_oauth_config(db_session)

    # state 직접 삽입 (auth-url을 mock 하지 않고 직접)
    from datetime import datetime, timezone
    ts = int(datetime.now(timezone.utc).timestamp())
    state = "TEST_VALID_STATE"
    db_session.add(SchoolConfig(
        key=f"oauth.google.state.{state}",
        value=f"{teacher_user.id}|{ts}",
        encrypted=False,
    ))
    await db_session.commit()

    # httpx 모킹
    import app.modules.google_integration.router as goog_router
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.get(f"/api/google/callback?code=FAKE_CODE&state={state}")
    assert r.status_code == 200

    # GoogleConnection 생성됨
    conn = (await db_session.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == teacher_user.id)
    )).scalar_one_or_none()
    assert conn is not None
    assert conn.google_email == "teacher@gmail.com"
    assert conn.refresh_token_encrypted != "fake-refresh"  # 암호화됨

    # state 1회용 — 사용 후 삭제
    state_row = (await db_session.execute(
        select(SchoolConfig).where(SchoolConfig.key == f"oauth.google.state.{state}")
    )).scalar_one_or_none()
    assert state_row is None or state_row.value is None


@pytest.mark.asyncio
async def test_callback_rejects_when_no_refresh_token(
    app_client, db_session, teacher_user, monkeypatch,
):
    """token exchange가 refresh_token 안 줬을 때 (재동의 필요)."""
    await _seed_oauth_config(db_session)
    from datetime import datetime, timezone
    ts = int(datetime.now(timezone.utc).timestamp())
    state = "NO_REFRESH_STATE"
    db_session.add(SchoolConfig(
        key=f"oauth.google.state.{state}",
        value=f"{teacher_user.id}|{ts}",
        encrypted=False,
    ))
    await db_session.commit()

    class _NoRefreshClient(_MockHttpxClient):
        async def post(self, url, **kwargs):
            if "oauth2.googleapis.com/token" in url:
                # refresh_token 없이 access_token만
                return _MockResponse(200, {"access_token": "fake-access"})
            return _MockResponse(404, {})

    import app.modules.google_integration.router as goog_router
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _NoRefreshClient)

    r = await app_client.get(f"/api/google/callback?code=X&state={state}")
    assert r.status_code == 400
    assert "refresh_token" in r.json().get("detail", "").lower() or "refresh" in r.json().get("detail", "")


@pytest.mark.asyncio
async def test_callback_blocks_email_collision_with_other_user(
    app_client, db_session, teacher_user, monkeypatch,
):
    """같은 google_email이 다른 사용자에게 이미 연결된 경우 409."""
    await _seed_oauth_config(db_session)

    # 다른 사용자 + GoogleConnection (같은 email)
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="o@test.local", name="O", role="teacher",
    )
    db_session.add(GoogleConnection(
        user_id=other.id,
        google_email="teacher@gmail.com",  # mock에서 받는 email과 동일
        refresh_token_encrypted=encrypt("other-refresh"),
        scope="x",
    ))

    from datetime import datetime, timezone
    ts = int(datetime.now(timezone.utc).timestamp())
    state = "COLLISION_STATE"
    db_session.add(SchoolConfig(
        key=f"oauth.google.state.{state}",
        value=f"{teacher_user.id}|{ts}",
        encrypted=False,
    ))
    await db_session.commit()

    import app.modules.google_integration.router as goog_router
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _MockHttpxClient)

    r = await app_client.get(f"/api/google/callback?code=X&state={state}")
    assert r.status_code == 409
    assert "이미" in r.json().get("detail", "")


@pytest.mark.asyncio
async def test_callback_token_exchange_failure_returns_400(
    app_client, db_session, teacher_user, monkeypatch,
):
    """Google이 token 교환 실패 응답 (400) → callback 400."""
    await _seed_oauth_config(db_session)

    from datetime import datetime, timezone
    ts = int(datetime.now(timezone.utc).timestamp())
    state = "FAIL_STATE"
    db_session.add(SchoolConfig(
        key=f"oauth.google.state.{state}",
        value=f"{teacher_user.id}|{ts}",
        encrypted=False,
    ))
    await db_session.commit()

    class _FailClient(_MockHttpxClient):
        async def post(self, url, **kwargs):
            return _MockResponse(400, {"error": "invalid_grant"})

    import app.modules.google_integration.router as goog_router
    monkeypatch.setattr(goog_router.httpx, "AsyncClient", _FailClient)

    r = await app_client.get(f"/api/google/callback?code=BADCODE&state={state}")
    assert r.status_code == 400
