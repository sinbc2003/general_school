"""클래스룸 설문 권한.

- classroom.survey.create       — 새 설문 생성 (교사·관리자)
- classroom.survey.edit         — 본인 설문 편집 + 질문 추가/수정/삭제 (작성자만)
- classroom.survey.respond      — 활성 설문에 응답 (학생 포함 모든 인증)
- classroom.survey.view_results — 응답 결과 조회 (작성자 + 관리자만, 라우터에서 추가 가드)
"""

PERMISSIONS = [
    {
        "key": "classroom.survey.create",
        "display_name": "설문지 생성",
        "category": "수업",
        "description": "강좌 내·외 설문지 생성. 교사·관리자.",
    },
    {
        "key": "classroom.survey.edit",
        "display_name": "설문지 편집",
        "category": "수업",
        "description": "본인 작성 설문의 질문·옵션 수정. 작성자만.",
    },
    {
        "key": "classroom.survey.respond",
        "display_name": "설문 응답",
        "category": "수업",
        "description": "활성화된 설문에 응답. 학생 포함 모든 역할.",
    },
    {
        "key": "classroom.survey.view_results",
        "display_name": "설문 결과 조회",
        "category": "수업",
        "description": "응답 결과·통계 조회. 작성자 + 관리자만 (라우터 가드).",
    },
]
