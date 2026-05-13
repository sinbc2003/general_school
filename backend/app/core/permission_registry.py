"""권한 자동 수집 + 일관성 검증

부팅 시 호출 순서:
1. main.py가 모든 모듈 라우터를 import → require_permission() 호출 시 _REGISTERED_KEYS에 키 등록됨
2. main.py가 collect_defined_permissions()로 모듈 permissions.py 자동 수집
3. main.py가 validate_permission_coverage()로 둘 비교 → 누락 시 RuntimeError

새 모듈 추가 워크플로:
1. app/modules/X/router.py에서 require_permission("X.action") 사용
2. app/modules/X/permissions.py 생성, PERMISSIONS 리스트에 같은 키 정의
3. main.py에 라우터 등록 (router 자체는 자동 수집 안 됨 : FastAPI 등록은 명시적 유지)
4. 부팅 시 자동 검증, 누락이면 어떤 키가 빠졌는지 명확히 알려줌
"""

import importlib
import pkgutil
from typing import Iterable

from app.core.permissions import (
    FRONTEND_ONLY_PERMISSIONS,
    get_registered_keys,
)


def collect_defined_permissions() -> list[dict]:
    """app/modules/*/permissions.py 자동 import → PERMISSIONS 수집

    + core의 FRONTEND_ONLY_PERMISSIONS도 포함.
    중복 키는 첫 번째만 사용 (이상 상황이므로 경고).
    """
    import app.modules as modules_pkg

    collected: dict[str, dict] = {}
    duplicates: list[str] = []

    # 모듈 자동 발견
    for _, module_name, is_pkg in pkgutil.iter_modules(modules_pkg.__path__):
        if not is_pkg:
            continue
        try:
            mod = importlib.import_module(f"app.modules.{module_name}.permissions")
        except ModuleNotFoundError:
            # permissions.py 없는 모듈은 권한 정의 없는 모듈 (auth 등) : OK
            continue

        perms = getattr(mod, "PERMISSIONS", None)
        if perms is None:
            continue
        for p in perms:
            if p["key"] in collected:
                duplicates.append(p["key"])
            else:
                collected[p["key"]] = p

    # 글로벌 권한도 추가
    for p in FRONTEND_ONLY_PERMISSIONS:
        if p["key"] in collected:
            duplicates.append(p["key"])
        else:
            collected[p["key"]] = p

    if duplicates:
        print(f"[PERM] WARN: 중복 권한 키 (첫 정의 사용): {duplicates}")

    return list(collected.values())


def validate_permission_coverage(defined: Iterable[dict]) -> None:
    """라우터에서 사용한 키 vs 정의된 키 일관성 검증

    raise RuntimeError if missing.
    경고만: 정의되었으나 라우터에서 안 쓰이는 키 (메뉴 표시용일 수도 있음).
    """
    used = get_registered_keys()
    defined_keys = {p["key"] for p in defined}

    missing = used - defined_keys
    if missing:
        raise RuntimeError(
            "[PERM] 정의 누락 : 라우터에서 require_permission()으로 사용했으나 "
            "해당 모듈의 permissions.py에 정의되지 않은 키가 있습니다:\n"
            + "\n".join(f"  - {k}" for k in sorted(missing))
            + "\n\n해결: app/modules/{모듈}/permissions.py의 PERMISSIONS 리스트에 정의를 추가하세요.\n"
            + "   예) {\"key\": \"%s\", \"display_name\": \"...\", \"category\": \"...\"}" % sorted(missing)[0]
        )

    unused = defined_keys - used
    # 제외 대상:
    # 1) FRONTEND_ONLY_PERMISSIONS — 라우터에서 안 쓰는 게 정상
    # 2) unused_ok=True로 표시된 권한 — require_permission_manager/super_admin 등 별도 dependency로 처리
    #    또는 라우터 구현 예정 (planned)
    frontend_only = {p["key"] for p in FRONTEND_ONLY_PERMISSIONS}
    unused_ok = {p["key"] for p in defined if p.get("unused_ok")}
    truly_unused = unused - frontend_only - unused_ok

    if truly_unused:
        print(
            f"[PERM] WARN: 정의되었으나 라우터에서 사용되지 않는 키 ({len(truly_unused)}개): "
            f"{sorted(truly_unused)}\n"
            f"  → 미사용이면 모듈 permissions.py에서 제거하거나, "
            f"unused_ok=True 표시 또는 FRONTEND_ONLY_PERMISSIONS로 옮기세요."
        )

    print(f"[PERM] 검증 완료 : 정의 {len(defined_keys)}개, 사용 {len(used)}개, 면제 {len(frontend_only | unused_ok)}개")
