# 라우터는 require_permission_manager() dependency로 보호됨 — require_permission() 직접 사용 안 함.
# 매트릭스/메뉴 표시 + SUPER_ADMIN_ONLY 인식용 등록.
PERMISSIONS = [
    {"key": "permission.manage.view", "display_name": "권한 조회", "category": "권한 관리", "unused_ok": True},
    {"key": "permission.manage.edit", "display_name": "권한 편집", "category": "권한 관리", "unused_ok": True},
]
