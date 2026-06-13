"""실시간 투표 권한.

- tools.poll.host — 투표 만들기·세션 진행 (교사 default 자동 부여)
- 학생 참여(join/respond)는 권한 키 없이 인증만 (get_current_user)
"""

PERMISSIONS = [
    {
        "key": "tools.poll.host",
        "display_name": "실시간 투표 진행",
        "category": "수업 도구",
        "description": "투표·워드클라우드를 만들고 라이브 세션을 진행 (교사)",
    },
]
