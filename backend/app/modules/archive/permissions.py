"""archive 모듈 권한 정의

이 파일에 등록된 권한만 시스템에서 인식됨.
새 권한 추가 → 라우터에서 require_permission("X") 사용 + 여기 정의
부팅 시 둘이 어긋나면 RuntimeError로 즉시 알려줌.
"""

PERMISSIONS = [
    {"key": "archive.document.upload", "display_name": "문서 업로드", "category": "아카이브"},
    {"key": "archive.document.edit", "display_name": "문서 편집", "category": "아카이브", "unused_ok": True},  # planned
    {"key": "archive.document.delete", "display_name": "문서 삭제", "category": "아카이브"},
    {"key": "archive.document.bulk_import", "display_name": "문서 일괄 가져오기", "category": "아카이브", "unused_ok": True},  # planned
    {"key": "archive.tag.manage", "display_name": "태그 관리", "category": "아카이브", "unused_ok": True},  # planned

    {"key": "problem.library.view", "display_name": "문제 라이브러리 조회", "category": "문제 관리"},
    {"key": "problem.library.create", "display_name": "문제 생성", "category": "문제 관리"},
    {"key": "problem.library.edit", "display_name": "문제 편집", "category": "문제 관리"},
    {"key": "problem.library.delete", "display_name": "문제 삭제", "category": "문제 관리"},
    {"key": "problem.library.review", "display_name": "문제 검토", "category": "문제 관리", "unused_ok": True},  # planned
    {"key": "problem.library.publish", "display_name": "문제 공개", "category": "문제 관리", "unused_ok": True},  # planned
]
