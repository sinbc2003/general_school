PERMISSIONS = [
    {"key": "timetable.view", "display_name": "시간표 조회", "category": "시간표"},
    {"key": "timetable.edit", "display_name": "시간표 편집", "category": "시간표"},

    # 학기 시스템 (NEIS 스타일 학기/명단 관리)
    {
        "key": "system.semester.manage",
        "display_name": "학기 관리(생성/수정/현재 학기 지정)",
        "category": "학기/명단",
        "is_sensitive": True,
    },
    {
        "key": "system.enrollment.manage",
        "display_name": "학기별 명단 관리(등록/진급/전출)",
        "category": "학기/명단",
        "is_sensitive": True,
    },
]
