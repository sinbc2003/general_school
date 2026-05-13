"""챗봇 모듈 권한 정의"""

PERMISSIONS = [
    {"key": "chatbot.use", "display_name": "챗봇 사용", "category": "AI 챗봇"},
    {"key": "chatbot.session.view_own", "display_name": "내 대화 조회", "category": "AI 챗봇"},
    {"key": "chatbot.session.delete_own", "display_name": "내 대화 삭제", "category": "AI 챗봇"},
    {"key": "chatbot.session.view_all", "display_name": "전체 대화 조회 (모니터링)", "category": "AI 챗봇"},
    # 관리자 전용 — API 키, 모델 단가, 시스템 프롬프트, 기본 설정
    {"key": "chatbot.provider.manage", "display_name": "LLM Provider/API 키 관리", "category": "AI 챗봇"},
    {"key": "chatbot.model.manage", "display_name": "LLM 모델/단가 관리", "category": "AI 챗봇"},
    {"key": "chatbot.prompt.manage", "display_name": "시스템 프롬프트 관리", "category": "AI 챗봇"},
    {"key": "chatbot.config.manage", "display_name": "챗봇 기본 설정 관리", "category": "AI 챗봇"},
    {"key": "chatbot.usage.view_all", "display_name": "전체 사용량/비용 조회", "category": "AI 챗봇"},
]
