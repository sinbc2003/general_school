"""정의에서 사라진 권한 키를 DB에서 안전하게 제거

실행:
  python -m scripts.cleanup_stale_permissions [--dry-run]

stale 권한은 자동 삭제되지 않음 (역할/사용자 할당이 함께 사라지면 권한이 통째로
빠질 수 있어서). 의도적으로 권한 키를 지웠을 때만 이 스크립트를 명시 실행.

삭제되는 것:
- permissions 테이블의 stale 행
- 해당 권한을 참조하는 role_permissions, user_permissions, permission_group_items 행
"""

import asyncio
import sys

from sqlalchemy import select, delete

from app.core.database import async_session_factory, init_db
from app.core.permission_registry import collect_defined_permissions
from app.models.permission import (
    Permission,
    RolePermission,
    UserPermission,
    PermissionGroupItem,
)


async def main(dry_run: bool) -> None:
    await init_db()
    async with async_session_factory() as db:
        defined_keys = {p["key"] for p in collect_defined_permissions()}
        existing = (await db.execute(select(Permission))).scalars().all()
        stale = [p for p in existing if p.key not in defined_keys]

        if not stale:
            print("[CLEANUP] stale 권한 없음. 종료.")
            return

        print(f"[CLEANUP] stale 권한 {len(stale)}개:")
        for p in stale:
            print(f"  - {p.key} (id={p.id})")

        if dry_run:
            print("\n[CLEANUP] --dry-run 모드 — 실제 삭제 안 함.")
            return

        confirm = input("\n위 권한들과 관련 할당을 모두 삭제합니다. 계속? (yes/no): ")
        if confirm != "yes":
            print("[CLEANUP] 취소됨.")
            return

        ids = [p.id for p in stale]
        await db.execute(delete(RolePermission).where(RolePermission.permission_id.in_(ids)))
        await db.execute(delete(UserPermission).where(UserPermission.permission_id.in_(ids)))
        await db.execute(delete(PermissionGroupItem).where(PermissionGroupItem.permission_id.in_(ids)))
        await db.execute(delete(Permission).where(Permission.id.in_(ids)))
        await db.commit()
        print(f"[CLEANUP] {len(stale)}개 권한 + 관련 할당 삭제 완료.")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(main(dry_run))
