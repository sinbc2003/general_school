PERMISSIONS = [
    {"key": "user.manage.view", "display_name": "사용자 조회", "category": "사용자 관리"},
    {"key": "user.manage.create", "display_name": "사용자 생성", "category": "사용자 관리",
     "requires_2fa": True, "is_sensitive": True},
    {"key": "user.manage.edit", "display_name": "사용자 편집", "category": "사용자 관리",
     "requires_2fa": True, "is_sensitive": True},
    {"key": "user.manage.delete", "display_name": "사용자 삭제", "category": "사용자 관리",
     "requires_2fa": True, "is_sensitive": True},
    {"key": "user.manage.bulk_import", "display_name": "사용자 일괄 등록", "category": "사용자 관리",
     "requires_2fa": True, "is_sensitive": True},
    {"key": "user.manage.quota", "display_name": "사용자 용량 할당", "category": "사용자 관리",
     "requires_2fa": True, "is_sensitive": True},
]
