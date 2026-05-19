"""클래스룸 협업 문서 권한.

- classroom.doc.create  — 새 문서 만들기 (교사·관리자)
- classroom.doc.edit    — 본인/공유받은 문서 편집 (교사·학생 모두; 라우터에서 멤버 검증)
- classroom.doc.view    — 문서 열람 (모든 인증; 라우터에서 access_mode 가드)
- classroom.doc.share   — 공유 설정 변경 — 작성자(소유자) 또는 관리자만 (라우터에서 추가 가드)
"""

PERMISSIONS = [
    {
        "key": "classroom.doc.create",
        "display_name": "협업 문서 생성",
        "category": "수업",
        "description": "강좌 내·외 협업 문서 생성. 교사·관리자 대상.",
    },
    {
        "key": "classroom.doc.edit",
        "display_name": "협업 문서 편집",
        "category": "수업",
        "description": "본인 작성 문서 또는 공유받은 문서 편집. 라우터에서 멤버십 가드.",
    },
    {
        "key": "classroom.doc.view",
        "display_name": "협업 문서 조회",
        "category": "수업",
        "description": "접근 가능한 문서 열람. 학생 포함 모든 역할 부여.",
    },
    {
        "key": "classroom.doc.share",
        "display_name": "협업 문서 공유 설정",
        "category": "수업",
        "description": "문서의 access_mode·멤버 추가/제거. 작성자(소유자) 또는 관리자.",
    },
]
