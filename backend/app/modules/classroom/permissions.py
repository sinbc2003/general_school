"""클래스룸 권한.

- classroom.course.manage  — 강좌 생성/편집/삭제, 자동 생성, 학생 명단 관리 (관리자·교사)
- classroom.course.view    — 강좌 조회 (모든 인증)
- classroom.post.write     — 클래스룸 글 작성 (교사, 본인 강좌만)
- classroom.post.view      — 글 조회 (해당 강좌 수강생 + 교사)
"""

PERMISSIONS = [
    {
        "key": "classroom.course.manage",
        "display_name": "강좌 관리",
        "category": "수업",
        "description": "강좌 생성·편집·삭제 + 학생 명단 등록 + 자동 생성",
    },
    {
        "key": "classroom.course.view",
        "display_name": "강좌 조회",
        "category": "수업",
        "description": "본인 강좌(교사) 또는 본인 수강 강좌(학생) 조회",
    },
    {
        "key": "classroom.post.write",
        "display_name": "클래스룸 글 작성",
        "category": "수업",
        "description": "강좌 내 공지·자료·과제 글 작성 (교사 본인 강좌만)",
    },
    {
        "key": "classroom.post.view",
        "display_name": "클래스룸 글 조회",
        "category": "수업",
        "description": "본인 수강 강좌의 글 읽기",
    },
]
