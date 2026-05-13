"""학생 본인 전용 권한 정의"""

PERMISSIONS = [
    # 본인 산출물 업로드/조회
    {"key": "student.artifact.manage", "display_name": "내 산출물 업로드/관리", "category": "학생 자기 영역"},
    {"key": "student.artifact.view_public", "display_name": "공개된 다른 학생 산출물 조회", "category": "학생 자기 영역"},
    # 진로 설계
    {"key": "student.career.manage", "display_name": "내 진로/진학 설계", "category": "학생 자기 영역"},
    # 선배 연구 열람
    {"key": "student.research.browse", "display_name": "선배 연구 자료 열람", "category": "학생 자기 영역"},
]
