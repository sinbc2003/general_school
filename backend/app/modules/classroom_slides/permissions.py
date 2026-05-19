"""클래스룸 프리젠테이션 권한.

- classroom.deck.create  — 새 deck 생성 (교사·관리자; 학생은 단독만 — 향후 P6)
- classroom.deck.edit    — 본인/공유받은 deck 편집
- classroom.deck.view    — deck 조회 (모든 인증; 라우터에서 access_mode 가드)
- classroom.deck.share   — 공유 설정 변경 (작성자 또는 admin)
"""

PERMISSIONS = [
    {
        "key": "classroom.deck.create",
        "display_name": "프리젠테이션 생성",
        "category": "수업",
        "description": "강좌 내·외 프리젠테이션 deck 생성.",
    },
    {
        "key": "classroom.deck.edit",
        "display_name": "프리젠테이션 편집",
        "category": "수업",
        "description": "본인 작성 또는 공유받은 deck 편집. 라우터에서 멤버 검증.",
    },
    {
        "key": "classroom.deck.view",
        "display_name": "프리젠테이션 조회",
        "category": "수업",
        "description": "접근 가능한 deck 열람. 학생 포함.",
    },
    {
        "key": "classroom.deck.share",
        "display_name": "프리젠테이션 공유 설정",
        "category": "수업",
        "description": "deck의 access_mode·멤버 추가/제거. 작성자 또는 관리자.",
    },
]
