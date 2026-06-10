"""단어장 권한.

- tools.wordbook.manage — 덱 생성·편집·삭제 (교사 default 자동 부여)
- 학습(study/progress)은 권한 키 없이 인증 + 접근 가드
  (소유자 / admin / is_public / 본인 강좌 글 첨부)
"""

PERMISSIONS = [
    {
        "key": "tools.wordbook.manage",
        "display_name": "단어장 만들기",
        "category": "수업 도구",
        "description": "단어 덱 생성·편집·삭제 + CSV 가져오기 (교사)",
    },
]
