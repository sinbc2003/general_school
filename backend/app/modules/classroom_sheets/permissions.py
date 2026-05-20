"""클래스룸 스프레드시트 권한 (Univer 기반).

ClassroomDocument와 동일 패턴:
- create: 교사·관리자 (학생도 단독 생성 가능 — 본인 작업물)
- view:   접근 권한자 모두
- edit:   소유자 + 명시 멤버(editor) + admin
"""

PERMISSIONS = [
    {
        "key": "classroom.sheet.create",
        "display_name": "스프레드시트 생성",
        "category": "수업",
        "description": "협업 스프레드시트 생성 (강좌 안 또는 단독)",
    },
    {
        "key": "classroom.sheet.view",
        "display_name": "스프레드시트 조회",
        "category": "수업",
        "description": "접근 권한 있는 시트 열람",
    },
    {
        "key": "classroom.sheet.edit",
        "display_name": "스프레드시트 편집",
        "category": "수업",
        "description": "본인 또는 멤버 editor 권한 시트 편집",
    },
]
