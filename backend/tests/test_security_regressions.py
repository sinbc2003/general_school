"""보안 회귀 테스트.

이전 검토에서 발견된 critical 이슈들이 다시 발생하지 않도록 명시 검증.
이 테스트가 깨지면 절대 배포 금지.
"""

import pytest

pytestmark = [pytest.mark.security]


# ── CRITICAL #1: ai_developer 권한 상승 차단 ──────────────

class TestAiDeveloperPathPolicy:
    """ai_developer가 권한 시스템·인증 코어 파일을 절대 수정할 수 없어야 함."""

    def test_permissions_py_blocked(self):
        """권한 코어 파일 — 차단."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/core/permissions.py")
        assert not is_path_allowed("backend/app/core/permission_registry.py")

    def test_main_py_blocked(self):
        """부팅 시드를 변경할 수 없어야 권한 우회 차단."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/main.py")

    def test_auth_files_blocked(self):
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/core/auth.py")
        assert not is_path_allowed("backend/app/core/config.py")
        assert not is_path_allowed("backend/app/core/encryption.py")
        assert not is_path_allowed("backend/app/core/password_policy.py")
        assert not is_path_allowed("backend/app/core/email.py")
        assert not is_path_allowed("backend/app/core/totp.py")
        assert not is_path_allowed("backend/app/core/visibility.py")

    def test_auth_router_blocked(self):
        """인증·권한 라우터도 차단."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/modules/auth/router.py")
        assert not is_path_allowed("backend/app/modules/permissions/router.py")

    def test_user_permission_models_blocked(self):
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/models/user.py")
        assert not is_path_allowed("backend/app/models/permission.py")
        assert not is_path_allowed("backend/app/models/device.py")
        assert not is_path_allowed("backend/app/models/audit.py")

    def test_seed_scripts_blocked(self):
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/scripts/seed.py")
        assert not is_path_allowed("backend/scripts/grant_default_roles.py")

    def test_env_blocked(self):
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed(".env")
        assert not is_path_allowed(".env.production")

    def test_alembic_prefix_blocked(self):
        """마이그레이션 디렉터리 전체 차단."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/alembic/env.py")
        assert not is_path_allowed("backend/alembic/versions/abc.py")

    def test_path_traversal_blocked(self):
        """../ 경로 traversal 차단."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("../etc/passwd")
        assert not is_path_allowed("backend/../../../etc/passwd")
        assert not is_path_allowed("backend/app/modules/../core/auth.py")

    def test_self_module_blocked(self):
        """ai_developer 자기 자신 파일 변경 차단 (재귀 권한 상승 차단)."""
        from app.modules.ai_developer.service import is_path_allowed
        assert not is_path_allowed("backend/app/modules/ai_developer/service.py")
        assert not is_path_allowed("backend/app/modules/ai_developer/router.py")

    def test_allowed_paths_still_work(self):
        """정상 경로는 통과해야 함 (negative regression)."""
        from app.modules.ai_developer.service import is_path_allowed
        assert is_path_allowed("frontend/src/app/(admin)/students/page.tsx")
        assert is_path_allowed("frontend/src/components/admin/Foo.tsx")
        assert is_path_allowed("backend/app/modules/club/router.py")
        # models 일반은 OK
        assert is_path_allowed("backend/app/models/club.py")


# ── CRITICAL #2: teacher의 user.manage.edit 권한 상승 차단 ─

async def test_grant_default_roles_excludes_user_manage_edit(db_session, seed_perms):
    """teacher가 user.manage.edit를 자동 부여받지 않아야 함 — 권한 상승 차단."""
    from sqlalchemy import select
    from app.models.permission import Permission, RolePermission
    from scripts.grant_default_roles import (
        grant_for_role, TEACHER_EXCLUDE_PREFIXES, TEACHER_EXCLUDE_KEYS,
        TEACHER_INCLUDE_KEYS,
    )

    all_keys = set(
        (await db_session.execute(select(Permission.key))).scalars().all()
    )
    teacher_keys = {
        k for k in all_keys
        if not k.startswith(TEACHER_EXCLUDE_PREFIXES) and k not in TEACHER_EXCLUDE_KEYS
    } | (TEACHER_INCLUDE_KEYS & all_keys)

    # user.manage.edit는 prefix "user.manage." 로 차단됨
    assert "user.manage.edit" not in teacher_keys, \
        "🔴 보안 회귀: teacher 디폴트 권한에 user.manage.edit 포함됨 — 권한 상승 가능"
    assert "user.manage.delete" not in teacher_keys
    assert "user.manage.create" not in teacher_keys
    # user.manage.view는 명시 화이트리스트로 허용
    assert "user.manage.view" in teacher_keys


# ── CRITICAL #3: 마지막 super_admin 보호 ──────────────────

async def test_cannot_remove_last_super_admin(
    app_client, super_admin, auth_headers,
):
    """super_admin 1명뿐인데 role 강등 시도 → 400."""
    headers = auth_headers(super_admin)
    # 본인을 student로 강등 시도
    resp = await app_client.put(
        f"/api/users/{super_admin.id}",
        json={"role": "student"},
        headers=headers,
    )
    # 본인 role 변경 차단 또는 마지막 super_admin 차단
    assert resp.status_code == 400


# ── CRITICAL #4: 권한 키 SUPER_ADMIN_ONLY 항상 차단 ───────

def test_super_admin_only_keys_defined():
    """SUPER_ADMIN_ONLY_KEYS는 비어있으면 안 됨 — 권한 시스템 의도."""
    from app.core.permissions import SUPER_ADMIN_ONLY_KEYS
    assert len(SUPER_ADMIN_ONLY_KEYS) > 0
    # 핵심 시스템 권한은 반드시 포함
    assert "system.backup.manage" in SUPER_ADMIN_ONLY_KEYS
    assert "permission.manage.edit" in SUPER_ADMIN_ONLY_KEYS
    assert "user.manage.delete" in SUPER_ADMIN_ONLY_KEYS


# ── 보안 fingerprint: 보안 키 디폴트 검증 ──────────────────

def test_production_mode_blocks_default_jwt_secret():
    """ENV=production이면 디폴트 JWT_SECRET 사용 시 부팅 차단."""
    from app.core.security_checks import check_production_secrets
    from app.core.config import settings

    # 디폴트 시크릿으로 production 시도 → RuntimeError
    original_env = settings.ENV
    original_jwt = settings.JWT_SECRET
    try:
        settings.ENV = "production"
        settings.JWT_SECRET = "change-this-in-production"
        with pytest.raises(RuntimeError, match="보안 키 디폴트"):
            check_production_secrets()
    finally:
        settings.ENV = original_env
        settings.JWT_SECRET = original_jwt


def test_dev_mode_only_warns_default_secret(capsys):
    """ENV=dev이면 디폴트 시크릿이라도 경고만 (부팅 차단 X)."""
    from app.core.security_checks import check_production_secrets
    from app.core.config import settings

    original_env = settings.ENV
    try:
        settings.ENV = "dev"
        # 디폴트 시크릿이면 stdout 경고 (예외 X)
        check_production_secrets()  # No exception
    finally:
        settings.ENV = original_env
