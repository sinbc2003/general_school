"""부서 권한 — super_admin/designated_admin 기본."""

PERMISSIONS = [
    {"key": "department.view", "display_name": "부서 목록 조회", "category": "조직 관리"},
    {"key": "department.manage", "display_name": "부서 등록·수정·삭제", "category": "조직 관리"},
]
