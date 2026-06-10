"""보드 권한.

- tools.board.manage — 보드 생성·설정·삭제 (교사 default 자동 부여)
- 카드 붙이기(참여)는 권한 키 없이 인증 + 접근 가드
  (소유자 / admin / 강좌 멤버 / 강좌 글 첨부 / public)
"""

PERMISSIONS = [
    {
        "key": "tools.board.manage",
        "display_name": "보드 만들기",
        "category": "수업 도구",
        "description": "Padlet형 담벼락 보드 생성·설정·삭제 (교사)",
    },
]
