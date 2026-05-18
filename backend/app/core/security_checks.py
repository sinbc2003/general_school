"""부팅 시 보안 설정 검증.

- ENV=production일 때 디폴트 시크릿 사용 금지 (RuntimeError로 부팅 중단)
- ENV=dev일 때는 경고만 (단일 worker / 외부 접근 차단 가정)

새 보안 키 추가 시 _CHECKS에 추가만 하면 자동 검증.
"""

import sys

from app.core.config import settings


# (setting_name, default_value, severity)
# severity: 'critical' (production에서 RuntimeError) / 'warning' (production에서도 경고만)
_CHECKS: list[tuple[str, str, str]] = [
    ("JWT_SECRET", "change-this-in-production", "critical"),
    ("ENCRYPTION_MASTER_KEY", "change-this-in-production", "critical"),
    ("SUPER_ADMIN_PASSWORD", "ChangeMe!2026", "warning"),  # env_seed 모드 사용 시
    ("DEFAULT_USER_PASSWORD", "school1234!", "warning"),
]


def check_production_secrets() -> None:
    """ENV=production이면 디폴트 시크릿 사용 시 부팅 차단.

    main.py lifespan 최상단에서 호출.
    """
    is_prod = (settings.ENV or "dev").lower() == "production"

    critical_violations = []
    warnings = []

    for name, default_value, severity in _CHECKS:
        current = getattr(settings, name, None)
        if current == default_value:
            if severity == "critical":
                critical_violations.append(name)
            else:
                warnings.append(name)

    if is_prod and critical_violations:
        msg = (
            "\n" + "=" * 70 + "\n"
            "🔴 부팅 차단: ENV=production에서 보안 키가 디폴트값입니다.\n"
            "다음 키들을 .env에 강한 랜덤 값으로 설정한 후 재시작하세요:\n\n"
            + "\n".join(f"  - {k}" for k in critical_violations)
            + "\n\n생성 예시 (Python):\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(64))\"\n"
            + "=" * 70
        )
        print(msg, file=sys.stderr)
        raise RuntimeError(
            f"보안 키 디폴트 사용 (production): {critical_violations}"
        )

    if critical_violations:  # dev 환경
        print(
            f"[SECURITY WARN] ENV={settings.ENV} — 보안 키 디폴트 사용 중: "
            f"{critical_violations}. production 전환 시 반드시 교체."
        )
    if warnings:
        print(
            f"[SECURITY WARN] 일반 비밀번호 디폴트 사용 중: "
            f"{warnings}. 운영 시 변경 권장."
        )
