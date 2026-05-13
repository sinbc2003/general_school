# 라우터는 require_super_admin() dependency로 보호됨 — require_permission() 직접 사용 안 함.
# 단, 매트릭스 UI / 메뉴 표시 / SUPER_ADMIN_ONLY_KEYS 인식을 위해 등록은 필요.
PERMISSIONS = [
    {"key": "system.health.view", "display_name": "시스템 상태", "category": "시스템", "unused_ok": True},
    {"key": "system.logs.view", "display_name": "로그 조회", "category": "시스템", "unused_ok": True},
    {"key": "system.backup.manage", "display_name": "백업 관리", "category": "시스템", "unused_ok": True},
    {"key": "system.settings.edit", "display_name": "설정 편집", "category": "시스템", "unused_ok": True},
    {"key": "system.feature_flags.manage", "display_name": "기능 플래그 관리", "category": "시스템", "unused_ok": True},
    {"key": "system.audit.view", "display_name": "감사 로그 조회", "category": "시스템", "unused_ok": True},
]
