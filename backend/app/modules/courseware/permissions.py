"""문제은행 코스웨어 권한.

- classroom.courseware.create  — 문제 세트 생성 (강좌 editor)
- classroom.courseware.view    — 문제 세트 조회 (강좌 멤버)
- classroom.courseware.edit    — 문제 세트 편집/삭제 (강좌 editor)
- classroom.courseware.submit  — 학생 답안 제출 (강좌 수강생)
- classroom.courseware.grade   — 수동 채점 + 결과 분석 (강좌 editor)

grant_default_roles.py에서 자동 부여:
  - teacher/staff/designated_admin: create/view/edit/grade
  - student: view/submit
"""

PERMISSIONS = [
    {
        "key": "classroom.courseware.create",
        "display_name": "문제 세트 생성",
        "category": "수업",
        "description": "강좌에서 자동채점 문제 세트 출제 (교사·관리자)",
    },
    {
        "key": "classroom.courseware.view",
        "display_name": "문제 세트 조회",
        "category": "수업",
        "description": "강좌 멤버가 출제된 문제 세트 보기",
    },
    {
        "key": "classroom.courseware.edit",
        "display_name": "문제 세트 편집",
        "category": "수업",
        "description": "강좌 editor가 문제 세트 편집·삭제·게시",
    },
    {
        "key": "classroom.courseware.submit",
        "display_name": "문제 답안 제출",
        "category": "수업",
        "description": "학생이 문제 세트에 답안 제출 (자동채점 트리거)",
    },
    {
        "key": "classroom.courseware.grade",
        "display_name": "문제 수동 채점·분석",
        "category": "수업",
        "description": "주관식 수동 채점 + 학생별 결과 분석 (교사)",
    },
]
