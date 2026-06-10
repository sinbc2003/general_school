"""권한 해석 모듈

설계 원칙:
- 보수적 기본값: 새 권한 키가 추가되면 super_admin + designated_admin만 자동 접근.
  교사/직원/학생에게는 관리자가 명시적으로 role_permissions에 추가해야 노출됨.
- 모듈별 권한 정의: 권한은 `app/modules/{X}/permissions.py`의 `PERMISSIONS` 리스트에 정의.
  자동 수집 — 새 모듈을 만들면 해당 폴더에 permissions.py 만들면 자동으로 시드/UI에 반영.
- 자동 추적: `require_permission("X")`를 호출하는 순간 `_REGISTERED_KEYS`에 자동 등록됨.
  부팅 시 `validate_permission_coverage()`가 코드와 정의를 비교 → 누락이면 RuntimeError.

지정관리자(designated_admin):
- SUPER_ADMIN_ONLY 제외 모든 권한 자동 접근
- 교사/직원/학생의 역할별 권한을 관리할 수 있음

새 모듈 추가하는 AI에게:
- 라우터에서 `require_permission("mymodule.action")` 사용
- `app/modules/mymodule/permissions.py`에 같은 키를 PERMISSIONS 리스트로 정의
- 둘 중 하나라도 빠뜨리면 부팅 시 즉시 알려줌 (RuntimeError 또는 WARN 로그)
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user, verify_2fa_session
from app.models.user import User
from app.models.permission import (
    Permission,
    RolePermission,
    UserPermission,
    UserPermissionGroup,
    PermissionGroupItem,
)

# super_admin 전용 권한 — designated_admin도 접근 불가
SUPER_ADMIN_ONLY_KEYS = {
    "system.health.view",
    "system.logs.view",
    "system.backup.manage",
    "system.settings.edit",
    "system.feature_flags.manage",
    "system.audit.view",
    "permission.manage.view",
    "permission.manage.edit",
    "user.manage.delete",
    # RCE-equivalent — 코드 생성/적용·자가 업데이트(git pull+pip+재시작)는 최고관리자 전용
    "system.ai_developer.use",
    "system.updates.apply",
}

# 모듈 공용 admin 판정 SSOT — 각 모듈에서 로컬 _is_admin 복붙 금지, 이걸 import.
ADMIN_ROLES = {"super_admin", "designated_admin"}


def is_admin(user: User) -> bool:
    """super_admin 또는 designated_admin 여부 (동기, DB 불필요)."""
    return user.role in ADMIN_ROLES

# 지정관리자 모드 — Setting 키 'permissions.designated_admin_mode'
#  "full"   : SUPER_ADMIN_ONLY 제외 모든 권한 자동 (디폴트, 기존 동작)
#  "scoped" : 일반 역할처럼 매트릭스에서 명시 부여한 권한만
DESIGNATED_ADMIN_MODE_KEY = "permissions.designated_admin_mode"
VALID_DESIGNATED_ADMIN_MODES = {"full", "scoped"}
DEFAULT_DESIGNATED_ADMIN_MODE = "full"

# admin 2FA 강제 정책 — Setting 키 'security.admin_2fa_required'
# True면 super_admin/designated_admin은 2FA 등록 필수.
# 미등록 상태로 로그인하면 /auth/2fa-setup 강제 redirect.
ADMIN_2FA_REQUIRED_KEY = "security.admin_2fa_required"
DEFAULT_ADMIN_2FA_REQUIRED = False


async def get_admin_2fa_required(db: AsyncSession) -> bool:
    from app.models.setting import Setting
    row = (await db.execute(
        select(Setting).where(Setting.key == ADMIN_2FA_REQUIRED_KEY)
    )).scalar_one_or_none()
    if not row or not row.value:
        return DEFAULT_ADMIN_2FA_REQUIRED
    return row.value.lower() in ("true", "1", "yes")


async def set_admin_2fa_required(db: AsyncSession, required: bool) -> None:
    from app.models.setting import Setting
    val = "true" if required else "false"
    row = (await db.execute(
        select(Setting).where(Setting.key == ADMIN_2FA_REQUIRED_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = val
    else:
        db.add(Setting(key=ADMIN_2FA_REQUIRED_KEY, value=val))


# 민감데이터 이메일 2FA 강제 — Setting 키 'security.sensitive_data_2fa_required'
# True면 교직원/관리자는 성적/상담/생기부 등 민감데이터 접근 시 유효한 2FA 세션
# (이메일 코드 또는 TOTP)이 필요하다. admin_2fa_required와 달리 **TOTP 등록을 강제하지 않음**
# — 이메일 코드로 인증하므로 인증앱 설치가 필요 없다. 학생은 본인 데이터만 보므로 면제.
SENSITIVE_2FA_REQUIRED_KEY = "security.sensitive_data_2fa_required"
DEFAULT_SENSITIVE_2FA_REQUIRED = False


async def get_sensitive_data_2fa_required(db: AsyncSession) -> bool:
    from app.models.setting import Setting
    row = (await db.execute(
        select(Setting).where(Setting.key == SENSITIVE_2FA_REQUIRED_KEY)
    )).scalar_one_or_none()
    if not row or not row.value:
        return DEFAULT_SENSITIVE_2FA_REQUIRED
    return row.value.lower() in ("true", "1", "yes")


async def set_sensitive_data_2fa_required(db: AsyncSession, required: bool) -> None:
    from app.models.setting import Setting
    val = "true" if required else "false"
    row = (await db.execute(
        select(Setting).where(Setting.key == SENSITIVE_2FA_REQUIRED_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = val
    else:
        db.add(Setting(key=SENSITIVE_2FA_REQUIRED_KEY, value=val))


async def get_designated_admin_mode(db: AsyncSession) -> str:
    """지정관리자 모드 조회. 디폴트 'full'.
    Setting 테이블에서 읽음 — 없으면 디폴트 반환.
    """
    from app.models.setting import Setting
    row = (await db.execute(
        select(Setting).where(Setting.key == DESIGNATED_ADMIN_MODE_KEY)
    )).scalar_one_or_none()
    val = (row.value if row else None) or DEFAULT_DESIGNATED_ADMIN_MODE
    return val if val in VALID_DESIGNATED_ADMIN_MODES else DEFAULT_DESIGNATED_ADMIN_MODE


async def set_designated_admin_mode(db: AsyncSession, mode: str) -> None:
    if mode not in VALID_DESIGNATED_ADMIN_MODES:
        raise ValueError(f"invalid mode: {mode}")
    from app.models.setting import Setting
    row = (await db.execute(
        select(Setting).where(Setting.key == DESIGNATED_ADMIN_MODE_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = mode
    else:
        db.add(Setting(key=DESIGNATED_ADMIN_MODE_KEY, value=mode))

# 라우터에서 require_permission()으로 실제 사용되는 키들 (자동 추적)
# 이 set은 모듈 라우터들이 import될 때 자동으로 채워진다.
_REGISTERED_KEYS: set[str] = set()


def get_registered_keys() -> set[str]:
    """라우터가 require_permission으로 실제 사용한 모든 키"""
    return set(_REGISTERED_KEYS)


# 라우터에서 require_permission()으로 직접 사용하지 않는 키들 (메뉴 표시·매트릭스용)
# 이 목록은 validator의 "사용 안 됨" WARN을 면제받는다.
# 의미:
#   - 일부 권한은 require_permission_manager() / require_super_admin() 등 별도 dependency로 대체됨
#     (그래도 매트릭스 UI / 메뉴 표시에는 등록되어야 함)
#   - 일부 권한은 백엔드 라우터가 아직 미구현이지만 UI에서 미리 노출 (planned)
FRONTEND_ONLY_PERMISSIONS: list[dict] = [
    # 글로벌 — 다른 모듈에 묶기 애매
    {"key": "student.dashboard.view", "display_name": "학생 대시보드", "category": "학생 대시보드"},
]


# Per-request 메모이제이션 캐시.
# 한 요청 안에서 같은 user에 대해 resolve_permissions가 여러 번 호출되는 패턴
# (require_permission decorator + me endpoint + matrix 등) — DB 쿼리 중복 차단.
# 키: user.id — 같은 세션·같은 사용자면 동일 결과.
# 한 요청이 끝나면 db session 사라지면서 자동 가비지 — 메모리 누수 없음.
_RESOLVE_CACHE_KEY = "_perm_resolve_cache"


def invalidate_resolve_cache(db: AsyncSession, user_id: int | None = None) -> None:
    """resolve_permissions 캐시 무효화. user_id=None이면 전체.

    같은 요청 안에서 권한을 변경한 뒤 다시 조회할 때 호출.
    update_user_permissions / set_enrollment_positions 등 권한 변경 endpoint에서
    명시적으로 호출하면 안전.
    """
    cache = db.info.get(_RESOLVE_CACHE_KEY)
    if not cache:
        return
    if user_id is None:
        cache.clear()
    else:
        cache.pop(user_id, None)


async def resolve_permissions(db: AsyncSession, user: User) -> set[str]:
    """사용자의 유효 권한 키 집합을 반환 (per-request 캐시).

    해석 순서:
    1. super_admin → 전체 권한 (short-circuit)
    2. designated_admin —
         · full 모드 (디폴트): 전체 권한 - SUPER_ADMIN_ONLY
         · scoped 모드:        role/user/group/position 합집합 (SUPER_ADMIN_ONLY 강제 제외)
    3. teacher/staff/student →
         role_permissions
       + user_permissions
       + user_permission_groups
       + 현재 학기 enrollment에 부여된 PositionTemplate.permission_keys (학기 격리)
    """
    # per-request cache — db.info dict에 user별 결과 메모이제이션
    cache = db.info.setdefault(_RESOLVE_CACHE_KEY, {})
    cached = cache.get(user.id)
    if cached is not None:
        return cached

    result = await _resolve_permissions_impl(db, user)
    cache[user.id] = result
    return result


async def _resolve_permissions_impl(db: AsyncSession, user: User) -> set[str]:
    """resolve_permissions 실제 구현 — 캐시 미스 시 호출."""
    if user.role == "super_admin":
        result = await db.execute(select(Permission.key))
        return set(result.scalars().all())

    if user.role == "designated_admin":
        mode = await get_designated_admin_mode(db)
        if mode == "full":
            result = await db.execute(select(Permission.key))
            all_keys = set(result.scalars().all())
            return all_keys - SUPER_ADMIN_ONLY_KEYS
        # scoped 모드: 아래 일반 역할 계산을 그대로 수행한 뒤 SUPER_ADMIN_ONLY 강제 제외.
        # (fall-through)

    perms: set[str] = set()

    result = await db.execute(
        select(Permission.key)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role == user.role)
    )
    perms.update(result.scalars().all())

    result = await db.execute(
        select(Permission.key)
        .join(UserPermission, UserPermission.permission_id == Permission.id)
        .where(UserPermission.user_id == user.id)
    )
    perms.update(result.scalars().all())

    result = await db.execute(
        select(Permission.key)
        .join(PermissionGroupItem, PermissionGroupItem.permission_id == Permission.id)
        .join(UserPermissionGroup, UserPermissionGroup.group_id == PermissionGroupItem.group_id)
        .where(UserPermissionGroup.user_id == user.id)
    )
    perms.update(result.scalars().all())

    # 현재 학기 직책(PositionTemplate) 기반 권한 — 학기 종료 시 자동 회수
    perms |= await _resolve_position_permissions(db, user.id)

    # designated_admin은 scoped 모드라도 SUPER_ADMIN_ONLY 권한 가질 수 없음
    if user.role == "designated_admin":
        perms -= SUPER_ADMIN_ONLY_KEYS

    return perms


async def _resolve_position_permissions(db: AsyncSession, user_id: int) -> set[str]:
    """현재 학기 본인 active enrollment의 직책 → 권한 키 합집합.

    학기 없음 / enrollment 없음 / status != active → 빈 set.
    PositionTemplate.permission_keys는 JSON 문자열로 저장. 존재하지 않는
    키는 결과에서 자동 제외 (Permission DB와 교집합).
    """
    import json
    from app.core.semester import get_current_semester
    from app.models.timetable import SemesterEnrollment
    from app.models.position import PositionTemplate, EnrollmentPosition

    sem = await get_current_semester(db)
    if not sem:
        return set()

    rows = (await db.execute(
        select(PositionTemplate.permission_keys)
        .join(EnrollmentPosition, EnrollmentPosition.position_template_id == PositionTemplate.id)
        .join(SemesterEnrollment, SemesterEnrollment.id == EnrollmentPosition.enrollment_id)
        .where(
            SemesterEnrollment.semester_id == sem.id,
            SemesterEnrollment.user_id == user_id,
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    keys: set[str] = set()
    for raw in rows:
        try:
            keys.update(json.loads(raw or "[]"))
        except (json.JSONDecodeError, TypeError):
            continue
    if not keys:
        return set()

    # 존재하는 권한 키만 (Permission DB와 교집합 — 향후 키 삭제 안전)
    valid = (await db.execute(
        select(Permission.key).where(Permission.key.in_(keys))
    )).scalars().all()
    return set(valid)


def require_permission(permission_key: str):
    """FastAPI dependency — 특정 권한 키가 있어야 접근 허용

    이 함수가 호출되는 순간 permission_key가 _REGISTERED_KEYS에 자동 추적된다.
    부팅 시 validator가 이 키들이 모두 모듈 permissions.py에 정의되어 있는지 검증.
    """
    _REGISTERED_KEYS.add(permission_key)

    async def _check(
        request: Request,
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if user.role == "super_admin":
            perm = await _get_permission(db, permission_key)
            if perm and perm.requires_2fa:
                await verify_2fa_session(user, request, db)
            return user

        if user.role == "designated_admin":
            if permission_key in SUPER_ADMIN_ONLY_KEYS:
                raise HTTPException(403, f"최고관리자 전용 권한: {permission_key}")
            # full 모드는 즉시 통과, scoped 모드는 명시 권한 확인
            mode = await get_designated_admin_mode(db)
            if mode == "scoped":
                user_perms = await resolve_permissions(db, user)
                if permission_key not in user_perms:
                    raise HTTPException(403, f"권한 부족: {permission_key}")
            perm = await _get_permission(db, permission_key)
            if perm and perm.requires_2fa:
                await verify_2fa_session(user, request, db)
            return user

        user_perms = await resolve_permissions(db, user)
        if permission_key not in user_perms:
            raise HTTPException(403, f"권한 부족: {permission_key}")

        perm = await _get_permission(db, permission_key)
        if perm and perm.requires_2fa:
            await verify_2fa_session(user, request, db)

        return user

    return _check


def require_admin():
    """super_admin 또는 designated_admin만 접근 허용"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("super_admin", "designated_admin"):
            raise HTTPException(403, "관리자 권한이 필요합니다")
        return user
    return _check


def require_super_admin():
    """super_admin만 접근 허용"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role != "super_admin":
            raise HTTPException(403, "최고관리자 권한이 필요합니다")
        return user
    return _check


def require_permission_manager():
    """권한 관리 가능한 사용자 — super_admin은 전체, designated_admin은 하위 역할만"""
    async def _check(user: User = Depends(get_current_user)) -> User:
        if user.role not in ("super_admin", "designated_admin"):
            raise HTTPException(403, "권한 관리 권한이 필요합니다")
        return user
    return _check


async def _get_permission(db: AsyncSession, key: str) -> Permission | None:
    result = await db.execute(select(Permission).where(Permission.key == key))
    return result.scalar_one_or_none()
