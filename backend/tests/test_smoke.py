"""Smoke tests — 인프라 동작 검증.

이 테스트가 통과하면 conftest, AsyncClient, DB override가 모두 정상 동작.
"""

import pytest


async def test_health_endpoint(app_client):
    """공개 health endpoint — 인증 없이 응답."""
    resp = await app_client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


async def test_bootstrap_status(app_client):
    """첫 가입 가능 여부 endpoint — 인증 없이 응답."""
    resp = await app_client.get("/api/auth/bootstrap-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "can_register" in data
    assert "user_count" in data


async def test_auth_required_for_protected_route(app_client):
    """인증 헤더 없으면 401."""
    resp = await app_client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_super_admin_fixture(super_admin, auth_headers, app_client):
    """super_admin fixture + auth_headers 토큰 발급 동작."""
    headers = auth_headers(super_admin)
    resp = await app_client.get("/api/auth/me", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "super_admin"
    assert data["email"] == "super@test.local"


async def test_db_isolated_between_tests(super_admin):
    """매 테스트가 새 in-memory DB라 super_admin 1명만 존재."""
    # fixture가 정상 동작했으면 super_admin.id == 1
    assert super_admin.id == 1
    assert super_admin.role == "super_admin"
