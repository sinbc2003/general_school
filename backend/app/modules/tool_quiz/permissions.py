"""라이브 퀴즈 권한.

- tools.quiz.host — 라이브 퀴즈 세션 생성·진행 (교사 default 자동 부여)
- 학생 참여(join/answer)는 권한 키 없이 인증만 (get_current_user)
"""

PERMISSIONS = [
    {
        "key": "tools.quiz.host",
        "display_name": "라이브 퀴즈 진행",
        "category": "수업 도구",
        "description": "문제 세트로 라이브 퀴즈 게임을 만들고 진행 (교사)",
    },
]
