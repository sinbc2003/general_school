"""AI 개발자 모듈 권한 정의.

super_admin은 항상 모든 권한. designated_admin은 super_admin이 권한 부여 시 사용 가능.

`system.ai_developer.use`는 sensitive — 코드 변경 권한이므로:
  - requires_2fa=True (실제 적용 시 2FA 인증 필요)
  - is_sensitive=True (audit log 강화)
"""

PERMISSIONS = [
    {
        "key": "system.ai_developer.use",
        "display_name": "AI 개발자 사용",
        "category": "시스템",
        "description": (
            "피드백/오류 보고를 받아 Claude/GPT API로 코드 개선을 의뢰·검토·적용. "
            "BLOCKED_FILES (인증·권한 핵심)는 자동 차단되며, 적용 후 회귀 테스트 자동 실행."
        ),
        "requires_2fa": True,
        "is_sensitive": True,
    },
]
