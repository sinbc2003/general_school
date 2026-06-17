"""자리배치 권한.

- tools.seating.host — 자리표 만들기·배치·인쇄 (교사·직원 default 자동 부여)
- 자리표는 교사 전용 도구. 학생용 페이지 없음 (출력은 교탁 게시용 인쇄).
"""

PERMISSIONS = [
    {
        "key": "tools.seating.host",
        "display_name": "자리배치 사용",
        "category": "수업 도구",
        "description": "교실 자리표 만들기·랜덤 배치·교탁 게시용 인쇄 (교사)",
    },
]
