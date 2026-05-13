"""시드 스크립트 : Super Admin + 권한 레지스트리 upsert

main.py의 lifespan에서 호출됨.

Upsert 전략:
- 새 키: INSERT
- 기존 키: display_name/category/description/2FA 플래그 변경 반영 (UPDATE)
- 정의에서 사라진 키: 삭제하지 않고 WARN 로그
  (역할/사용자 할당이 사라지면 권한이 통째로 빠질 수 있음 : stale 정리는 별도 명령어)
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.auth import hash_password
from app.models.user import User
from app.models.permission import Permission


async def seed_super_admin(db: AsyncSession) -> None:
    """최고관리자 계정 시드"""
    result = await db.execute(
        select(User).where(User.username == settings.SUPER_ADMIN_USERNAME)
    )
    existing = result.scalar_one_or_none()

    if not existing:
        admin = User(
            username=settings.SUPER_ADMIN_USERNAME,
            email=settings.SUPER_ADMIN_EMAIL,
            name="최고관리자",
            password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
            role="super_admin",
            status="approved",
            must_change_password=False,
        )
        db.add(admin)
        await db.flush()
        print(f"[SEED] 최고관리자 생성: {settings.SUPER_ADMIN_USERNAME}")
    else:
        print(f"[SEED] 최고관리자 이미 존재: {settings.SUPER_ADMIN_USERNAME}")


async def seed_permissions(db: AsyncSession, defined: list[dict]) -> None:
    """권한 레지스트리 upsert

    defined: collect_defined_permissions() 결과
    """
    existing_result = await db.execute(select(Permission))
    existing: dict[str, Permission] = {p.key: p for p in existing_result.scalars().all()}

    added = 0
    updated = 0
    defined_keys: set[str] = set()

    for d in defined:
        defined_keys.add(d["key"])
        display_name = d["display_name"]
        category = d["category"]
        description = d.get("description")
        requires_2fa = d.get("requires_2fa", False)
        is_sensitive = d.get("is_sensitive", False)

        if d["key"] in existing:
            p = existing[d["key"]]
            changed = (
                p.display_name != display_name
                or p.category != category
                or p.description != description
                or p.requires_2fa != requires_2fa
                or p.is_sensitive != is_sensitive
            )
            if changed:
                p.display_name = display_name
                p.category = category
                p.description = description
                p.requires_2fa = requires_2fa
                p.is_sensitive = is_sensitive
                updated += 1
        else:
            db.add(Permission(
                key=d["key"],
                display_name=display_name,
                category=category,
                description=description,
                requires_2fa=requires_2fa,
                is_sensitive=is_sensitive,
            ))
            added += 1

    await db.flush()

    stale = set(existing.keys()) - defined_keys
    if stale:
        print(
            f"[SEED] WARN: 정의에서 사라진 권한 {len(stale)}개 DB에 잔존: {sorted(stale)}\n"
            f"  → 모듈 permissions.py에서 삭제했다면, 안전하게 정리하려면 "
            f"scripts/cleanup_stale_permissions.py 실행 (역할/사용자 할당도 함께 삭제됨)."
        )

    msg = f"[SEED] 권한 레지스트리 : 정의 {len(defined_keys)}개"
    if added:
        msg += f", +추가 {added}"
    if updated:
        msg += f", ~수정 {updated}"
    if stale:
        msg += f", !stale {len(stale)}"
    print(msg)

    # default_roles 처리 — 권한 정의에 명시된 역할에 자동 부여
    # (이미 부여된 건 건너뜀. 관리자가 매트릭스에서 해제한 건 다시 추가 안 함 — 처음 등장 시에만 부여)
    from app.models.permission import RolePermission
    grant_added = 0
    for d in defined:
        roles = d.get("default_roles") or []
        if not roles:
            continue
        # 이 권한이 새로 추가됐을 때만 default_roles 적용 (added_keys 추적이 없으므로,
        # 단순히 "현재 role_permissions에 어떤 역할도 없으면 default_roles 부여"로 판단)
        perm_obj = (await db.execute(
            select(Permission).where(Permission.key == d["key"])
        )).scalar_one_or_none()
        if not perm_obj:
            continue
        # 현재 부여된 역할 조회
        existing_roles = (await db.execute(
            select(RolePermission.role).where(RolePermission.permission_id == perm_obj.id)
        )).scalars().all()
        # 단 한 번도 부여된 적이 없으면 default_roles로 초기화
        if not existing_roles:
            for role in roles:
                db.add(RolePermission(role=role, permission_id=perm_obj.id, granted_by=None))
                grant_added += 1
    if grant_added:
        await db.flush()
        print(f"[SEED] default_roles 자동 부여 {grant_added}건")


async def run_seeds(db: AsyncSession) -> None:
    """main.py lifespan에서 호출"""
    from app.core.permission_registry import collect_defined_permissions

    await seed_super_admin(db)
    defined = collect_defined_permissions()
    await seed_permissions(db, defined)
