"""Quota 헬퍼 단위 테스트.

검증:
  - 역할별 기본 quota 매핑
  - check_quota: 무제한, 파일 한도, quota 초과
  - consume/release/adjust: 정확한 차감·환원·음수 방지
  - is_unlimited: super_admin / 0 sentinel
  - assign_default_quota: 신규 사용자 자동 부여
"""

import pytest
from fastapi import HTTPException

from app.core.quota import (
    DEFAULT_QUOTA_BY_ROLE, FILE_SIZE_LIMIT, TEMPORARY_QUOTA,
    assign_default_quota, check_quota, consume_quota, release_quota,
    adjust_quota, default_quota_for, is_unlimited,
)
from app.models.user import User


def _make_user(role: str = "teacher", quota_mb: int = 500, used_mb: int = 0,
               user_type: str = "regular") -> User:
    """순수 모델 인스턴스 (DB add 없음 — 단위 테스트용)."""
    u = User()
    u.id = 1
    u.email = "x@x.x"
    u.name = "X"
    u.role = role
    u.password_hash = "x"
    u.status = "approved"
    u.user_type = user_type
    u.quota_bytes = quota_mb * 1024 * 1024
    u.used_bytes = used_mb * 1024 * 1024
    return u


# ── default_quota_for ─────────────────────────────────────


def test_default_quota_for_teacher_500mb():
    assert default_quota_for("teacher") == 500 * 1024 * 1024


def test_default_quota_for_student_200mb():
    assert default_quota_for("student") == 200 * 1024 * 1024


def test_default_quota_for_temporary_user_50mb():
    assert default_quota_for("teacher", user_type="temporary") == TEMPORARY_QUOTA
    assert default_quota_for("teacher", user_type="substitute") == TEMPORARY_QUOTA


def test_default_quota_for_super_admin_zero_sentinel():
    assert DEFAULT_QUOTA_BY_ROLE["super_admin"] == 0


def test_default_quota_for_unknown_role_falls_back_to_200mb():
    assert default_quota_for("unknown") == 200 * 1024 * 1024


# ── is_unlimited ──────────────────────────────────────────


def test_is_unlimited_super_admin():
    u = _make_user(role="super_admin", quota_mb=0)
    assert is_unlimited(u) is True


def test_is_unlimited_zero_quota_sentinel():
    u = _make_user(role="teacher", quota_mb=0)
    assert is_unlimited(u) is True


def test_is_unlimited_teacher_with_quota_false():
    u = _make_user(role="teacher", quota_mb=500)
    assert is_unlimited(u) is False


# ── check_quota ───────────────────────────────────────────


def test_check_quota_pass_within_limit():
    u = _make_user(quota_mb=500, used_mb=100)
    # 1MB 추가 OK
    check_quota(u, 1 * 1024 * 1024)


def test_check_quota_rejects_oversized_single_file():
    u = _make_user(quota_mb=500, used_mb=0)
    with pytest.raises(HTTPException) as ei:
        check_quota(u, FILE_SIZE_LIMIT + 1)
    assert ei.value.status_code == 413
    assert ei.value.detail["code"] == "FILE_TOO_LARGE"


def test_check_quota_rejects_over_quota():
    u = _make_user(quota_mb=500, used_mb=480)
    # 100MB 추가 = 580MB > 500MB
    with pytest.raises(HTTPException) as ei:
        check_quota(u, 30 * 1024 * 1024)
    assert ei.value.status_code == 413
    assert ei.value.detail["code"] == "QUOTA_EXCEEDED"


def test_check_quota_super_admin_unlimited():
    u = _make_user(role="super_admin", quota_mb=0)
    # 누적 quota는 무제한이지만 단일 파일 한도(FILE_SIZE_LIMIT)는 여전히 적용.
    # FILE_SIZE_LIMIT 이내면 통과
    check_quota(u, FILE_SIZE_LIMIT - 1)
    # 초과는 거부
    with pytest.raises(HTTPException) as ei:
        check_quota(u, FILE_SIZE_LIMIT + 1)
    assert ei.value.detail["code"] == "FILE_TOO_LARGE"


def test_check_quota_ignores_zero_or_negative():
    u = _make_user(quota_mb=500, used_mb=400)
    # 0 또는 음수는 무시 (예외 없음)
    check_quota(u, 0)
    check_quota(u, -100)


# ── consume / release / adjust (DB 없는 mock) ─────────────


class _MockDB:
    """flush()만 흉내내는 mock."""
    async def flush(self):
        pass


@pytest.mark.asyncio
async def test_consume_quota_adds_used_bytes():
    u = _make_user(quota_mb=500, used_mb=100)
    db = _MockDB()
    delta = 5 * 1024 * 1024
    await consume_quota(db, u, delta, notify_threshold=False)
    assert u.used_bytes == (100 + 5) * 1024 * 1024


@pytest.mark.asyncio
async def test_consume_quota_raises_on_over_quota():
    u = _make_user(quota_mb=100, used_mb=90)
    db = _MockDB()
    with pytest.raises(HTTPException):
        await consume_quota(db, u, 20 * 1024 * 1024, notify_threshold=False)


@pytest.mark.asyncio
async def test_consume_quota_check_false_bypasses_validation():
    u = _make_user(quota_mb=100, used_mb=90)
    db = _MockDB()
    # check=False → quota 초과해도 통과 (admin 작업 등)
    await consume_quota(db, u, 20 * 1024 * 1024, check=False, notify_threshold=False)
    assert u.used_bytes > u.quota_bytes


@pytest.mark.asyncio
async def test_release_quota_subtracts():
    u = _make_user(quota_mb=500, used_mb=100)
    db = _MockDB()
    await release_quota(db, u, 30 * 1024 * 1024)
    assert u.used_bytes == 70 * 1024 * 1024


@pytest.mark.asyncio
async def test_release_quota_never_negative():
    u = _make_user(quota_mb=500, used_mb=10)
    db = _MockDB()
    await release_quota(db, u, 100 * 1024 * 1024)
    assert u.used_bytes == 0


@pytest.mark.asyncio
async def test_adjust_quota_grows():
    u = _make_user(quota_mb=500, used_mb=100)
    db = _MockDB()
    await adjust_quota(db, u, old_bytes=1_000_000, new_bytes=5_000_000)
    assert u.used_bytes == 100 * 1024 * 1024 + 4_000_000


@pytest.mark.asyncio
async def test_adjust_quota_shrinks():
    u = _make_user(quota_mb=500, used_mb=100)
    db = _MockDB()
    await adjust_quota(db, u, old_bytes=10_000_000, new_bytes=2_000_000)
    assert u.used_bytes == 100 * 1024 * 1024 - 8_000_000


# ── assign_default_quota ──────────────────────────────────


def test_assign_default_quota_for_teacher():
    u = User()
    u.role = "teacher"
    u.user_type = "regular"
    u.quota_bytes = 0
    assign_default_quota(u)
    assert u.quota_bytes == 500 * 1024 * 1024


def test_assign_default_quota_for_student():
    u = User()
    u.role = "student"
    u.user_type = "regular"
    u.quota_bytes = 0
    assign_default_quota(u)
    assert u.quota_bytes == 200 * 1024 * 1024


def test_assign_default_quota_super_admin_stays_zero():
    u = User()
    u.role = "super_admin"
    u.user_type = "regular"
    u.quota_bytes = 0
    assign_default_quota(u)
    assert u.quota_bytes == 0


def test_assign_default_quota_temporary_50mb():
    u = User()
    u.role = "teacher"
    u.user_type = "temporary"
    u.quota_bytes = 0
    assign_default_quota(u)
    assert u.quota_bytes == TEMPORARY_QUOTA


def test_assign_default_quota_does_not_overwrite_existing():
    u = User()
    u.role = "teacher"
    u.user_type = "regular"
    u.quota_bytes = 1_000_000_000  # 이미 1GB
    assign_default_quota(u)
    assert u.quota_bytes == 1_000_000_000  # 그대로
