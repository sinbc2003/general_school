"""공유 화이트보드 권한.

- tools.whiteboard.manage — 화이트보드 생성·설정·삭제 (교사 default 자동 부여)
- 그리기(참여)는 권한 키 없이 인증 + 접근 가드
  (소유자 / admin / 강좌 멤버 / 강좌 글 첨부 / public)
"""

PERMISSIONS = [
    {
        "key": "tools.whiteboard.manage",
        "display_name": "화이트보드 만들기",
        "category": "수업 도구",
        "description": "실시간 공유 화이트보드 생성·설정·삭제 (교사)",
    },
]
