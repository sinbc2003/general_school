"""인증 흐름 테스트 — login, register, email 2FA challenge, 신뢰 장치.
"""

import pytest

pytestmark = [pytest.mark.auth, pytest.mark.security]


# ── 학생 로그인 (이메일 2FA 비대상) ─────────────────────

async def test_student_login_returns_token_immediately(
    app_client, student_user,
):
    """학생은 비밀번호 통과 시 즉시 토큰 (이메일 2FA 우회)."""
    resp = await app_client.post(
        "/api/auth/login",
        json={"identifier": student_user.email, "password": "TestPass123!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "token"
    assert "access_token" in data
    assert "refresh_token" in data


# ── 교사 로그인 (이메일 2FA 챌린지) ────────────────────

async def test_teacher_login_starts_email_challenge(
    app_client, teacher_user,
):
    """교사는 신뢰 장치 없으면 이메일 챌린지 단계로 진입."""
    resp = await app_client.post(
        "/api/auth/login",
        json={"identifier": teacher_user.email, "password": "TestPass123!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "challenge"
    assert "challenge_token" in data
    assert "email_masked" in data
    # 마스킹 확인
    assert "***" in data["email_masked"]


async def test_teacher_login_wrong_password_blocked(
    app_client, teacher_user,
):
    """잘못된 비밀번호는 401."""
    resp = await app_client.post(
        "/api/auth/login",
        json={"identifier": teacher_user.email, "password": "WrongPass"},
    )
    assert resp.status_code == 401


async def test_email_challenge_invalid_code_rejects(
    app_client, teacher_user,
):
    """잘못된 코드는 400."""
    # 1. login → 챌린지 시작
    resp = await app_client.post(
        "/api/auth/login",
        json={"identifier": teacher_user.email, "password": "TestPass123!"},
    )
    challenge_token = resp.json()["challenge_token"]

    # 2. 잘못된 코드 제출
    resp = await app_client.post(
        "/api/auth/login/verify-email",
        json={
            "challenge_token": challenge_token,
            "code": "000000",
            "remember_device": False,
        },
    )
    assert resp.status_code == 400


# ── 회원가입 race condition 방어 ─────────────────────────

async def test_register_blocked_when_users_exist(
    app_client, super_admin,
):
    """super_admin이 이미 있으면 추가 register는 403."""
    resp = await app_client.post(
        "/api/auth/register",
        json={
            "name": "Should Fail",
            "email": "shouldfail@test.local",
            "username": "shouldfail",
            "password": "TestPass123!",
        },
    )
    assert resp.status_code == 403


async def test_first_register_succeeds_with_password_policy(
    app_client, seed_perms,
):
    """user 0명일 때 register는 super_admin 생성. 비번 정책 검증 포함."""
    # 비번 정책 위반 — 6자
    resp = await app_client.post(
        "/api/auth/register",
        json={
            "name": "Admin",
            "email": "admin@test.local",
            "username": "admin1",
            "password": "short",
        },
    )
    assert resp.status_code == 400

    # 정책 통과
    resp = await app_client.post(
        "/api/auth/register",
        json={
            "name": "Admin",
            "email": "admin@test.local",
            "username": "admin1",
            "password": "StrongPass1!",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["user"]["role"] == "super_admin"


# ── change-password 정책 검증 ─────────────────────────────

async def test_change_password_enforces_policy(
    app_client, teacher_user, auth_headers,
):
    """약한 새 비번은 400 (영문/숫자 부족)."""
    headers = auth_headers(teacher_user)
    resp = await app_client.post(
        "/api/auth/change-password",
        json={"current_password": "TestPass123!", "new_password": "weakpass"},
        headers=headers,
    )
    # 영문만 있고 숫자 없음 → 정책 위반
    assert resp.status_code == 400


# ── 신뢰 장치 endpoint ────────────────────────────────────

async def test_list_trusted_devices_empty_initially(
    app_client, teacher_user, auth_headers,
):
    """새 사용자는 신뢰 장치 0개."""
    headers = auth_headers(teacher_user)
    resp = await app_client.get("/api/auth/trusted-devices", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["items"] == []
