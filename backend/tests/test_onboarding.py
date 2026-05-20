"""온보딩 마법사 API 통합 테스트.

검증:
  - GET  /api/system/onboarding/status: 초기 상태 (학교 정보 default)
  - POST /api/system/onboarding/school: 학교 정보 저장 후 status 반영
  - POST /api/system/onboarding/step: 단계 번호 마크 (재진입)
  - POST /api/system/onboarding/complete: completed_at 마크
  - POST /api/system/onboarding/reset: 다시 보기 (데이터 보존)
  - super_admin 전용 가드
"""

import pytest


@pytest.mark.asyncio
async def test_onboarding_status_initial_state(app_client, super_admin, auth_headers):
    r = await app_client.get("/api/system/onboarding/status", headers=auth_headers(super_admin))
    assert r.status_code == 200
    data = r.json()
    assert data["completed_at"] is None
    assert data["last_step"] == 0
    assert data["school"]["name"] is None
    assert data["school"]["type"] == "high"
    assert data["school"]["grade_count"] == 3


@pytest.mark.asyncio
async def test_onboarding_school_save_and_status_reflects(
    app_client, super_admin, auth_headers,
):
    r = await app_client.post(
        "/api/system/onboarding/school",
        json={"name": "테스트고등학교", "type": "high", "grade_count": 3},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200

    # status에 반영
    r2 = await app_client.get("/api/system/onboarding/status", headers=auth_headers(super_admin))
    data = r2.json()
    assert data["school"]["name"] == "테스트고등학교"
    assert data["school"]["type"] == "high"


@pytest.mark.asyncio
async def test_onboarding_school_validates_type(app_client, super_admin, auth_headers):
    r = await app_client.post(
        "/api/system/onboarding/school",
        json={"name": "X", "type": "university", "grade_count": 3},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 422  # pydantic regex (^elem|mid|high$)


@pytest.mark.asyncio
async def test_onboarding_school_validates_grade_count_range(
    app_client, super_admin, auth_headers,
):
    r = await app_client.post(
        "/api/system/onboarding/school",
        json={"name": "X", "type": "high", "grade_count": 99},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_step_save_and_restore(app_client, super_admin, auth_headers):
    await app_client.post(
        "/api/system/onboarding/step",
        json={"step": 4},
        headers=auth_headers(super_admin),
    )
    r = await app_client.get("/api/system/onboarding/status", headers=auth_headers(super_admin))
    assert r.json()["last_step"] == 4


@pytest.mark.asyncio
async def test_onboarding_complete_marks_completed_at(
    app_client, super_admin, auth_headers,
):
    r = await app_client.post(
        "/api/system/onboarding/complete", headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["completed_at"] is not None

    r2 = await app_client.get("/api/system/onboarding/status", headers=auth_headers(super_admin))
    assert r2.json()["completed_at"] is not None


@pytest.mark.asyncio
async def test_onboarding_reset_clears_completed_at(
    app_client, super_admin, auth_headers,
):
    await app_client.post("/api/system/onboarding/complete", headers=auth_headers(super_admin))
    await app_client.post("/api/system/onboarding/step", json={"step": 5}, headers=auth_headers(super_admin))

    r = await app_client.post("/api/system/onboarding/reset", headers=auth_headers(super_admin))
    assert r.status_code == 200

    r2 = await app_client.get("/api/system/onboarding/status", headers=auth_headers(super_admin))
    data = r2.json()
    assert data["completed_at"] is None
    assert data["last_step"] == 0


# ── 권한 가드 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_onboarding_status_requires_super_admin(
    app_client, teacher_user, auth_headers,
):
    """super_admin 아니면 403."""
    r = await app_client.get("/api/system/onboarding/status", headers=auth_headers(teacher_user))
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_onboarding_complete_requires_super_admin(
    app_client, designated_admin, auth_headers,
):
    """designated_admin도 onboarding은 super_admin 전용."""
    r = await app_client.post(
        "/api/system/onboarding/complete", headers=auth_headers(designated_admin),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_onboarding_no_auth_rejected(app_client):
    """인증 없으면 401."""
    r = await app_client.get("/api/system/onboarding/status")
    assert r.status_code == 401
