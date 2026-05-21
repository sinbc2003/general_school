"""tool_ai 모듈 권한.

AI 도우미는 교사·직원 전용 (학생 제외).
super_admin은 자동 pass.
"""

PERMISSIONS = [
    {
        "key": "tool.ai_assistant.use",
        "display_name": "AI 도우미 사용 (문서/시트/슬라이드/설문)",
        "category": "AI 도우미",
        "description": (
            "교사·직원이 문서·시트·슬라이드·설문 편집 시 우측 AI 사이드바를 사용. "
            "최고관리자가 등록한 API 키 + tool_ai_enabled 모델 화이트리스트 사용."
        ),
    },
]
