# 라우터는 require_super_admin() dependency로 보호됨 — require_permission() 직접 사용 안 함.
# 단, 매트릭스 UI / 메뉴 표시 / SUPER_ADMIN_ONLY_KEYS 인식을 위해 등록은 필요.
# requires_2fa는 매트릭스 UI에 자물쇠 표시. 실제 강제는 system 라우터의 endpoint별 호출 참조.
PERMISSIONS = [
    {"key": "system.health.view", "display_name": "시스템 상태", "category": "시스템", "unused_ok": True},
    {"key": "system.logs.view", "display_name": "로그 조회", "category": "시스템", "unused_ok": True},
    {"key": "system.backup.manage", "display_name": "백업 관리", "category": "시스템", "unused_ok": True,
     "requires_2fa": True, "is_sensitive": True},
    {"key": "system.settings.edit", "display_name": "설정 편집", "category": "시스템", "unused_ok": True,
     "requires_2fa": True, "is_sensitive": True},
    {"key": "system.feature_flags.manage", "display_name": "기능 플래그 관리", "category": "시스템", "unused_ok": True},
    {"key": "system.audit.view", "display_name": "감사 로그 조회", "category": "시스템", "unused_ok": True,
     "requires_2fa": True, "is_sensitive": True},
]
