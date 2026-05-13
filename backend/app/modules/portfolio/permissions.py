PERMISSIONS = [
    {"key": "portfolio.grade.view", "display_name": "성적 조회", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.grade.edit", "display_name": "성적 편집", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.award.view", "display_name": "수상 조회", "category": "학생 포트폴리오"},
    {"key": "portfolio.award.edit", "display_name": "수상 편집", "category": "학생 포트폴리오"},
    {"key": "portfolio.thesis.view", "display_name": "논문 조회", "category": "학생 포트폴리오"},
    {"key": "portfolio.thesis.edit", "display_name": "논문 편집", "category": "학생 포트폴리오"},
    {"key": "portfolio.counseling.view", "display_name": "상담 조회", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.counseling.edit", "display_name": "상담 편집", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.record.view", "display_name": "생활기록 조회", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.record.edit", "display_name": "생활기록 편집", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.mockexam.view", "display_name": "모의고사 조회", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    {"key": "portfolio.mockexam.edit", "display_name": "모의고사 편집", "category": "학생 포트폴리오", "requires_2fa": True, "is_sensitive": True},
    # 학생 본인 산출물 / 진로 계획 — 교사가 지도 목적으로 조회
    # default_roles로 신규 등록 시 teacher/staff에 자동 부여
    {"key": "portfolio.artifact.view", "display_name": "학생 산출물 조회 (교사용)",
     "category": "학생 포트폴리오", "default_roles": ["teacher", "staff"]},
    {"key": "portfolio.career.view", "display_name": "학생 진로계획 조회 (교사용)",
     "category": "학생 포트폴리오", "default_roles": ["teacher", "staff"]},
]
