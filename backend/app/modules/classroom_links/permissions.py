"""클래스룸 단축 링크 권한.

- classroom.link.create — 새 단축 링크 생성 (교사·관리자 기본 부여)

조회·QR 다운로드는 별도 권한 X (생성자만 라우터 가드).
slug 자체는 의도적으로 공개 (학생에게 배포가 본질).
단 그 slug로 가서 응답하려면 target(설문) 권한 필요 — 별도 라우터에서 검증.
"""

PERMISSIONS = [
    {
        "key": "classroom.link.create",
        "display_name": "단축 링크 생성",
        "category": "수업",
        "description": "설문·문서용 단축 링크 + QR 코드 생성. 교사·관리자.",
    },
]
