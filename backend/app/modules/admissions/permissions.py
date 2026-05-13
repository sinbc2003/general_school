PERMISSIONS = [
    {"key": "admissions.question.view", "display_name": "입시문제 조회", "category": "입시"},
    {"key": "admissions.question.manage", "display_name": "입시문제 관리", "category": "입시"},
    {"key": "admissions.record.view", "display_name": "입시기록 조회", "category": "입시", "requires_2fa": True, "is_sensitive": True},
    {"key": "admissions.record.manage", "display_name": "입시기록 관리", "category": "입시", "requires_2fa": True, "is_sensitive": True},
    {"key": "admissions.analysis.view", "display_name": "합격 분석", "category": "입시", "unused_ok": True},  # planned
]
