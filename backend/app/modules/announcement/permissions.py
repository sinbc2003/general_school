"""공지사항 권한 정의"""

PERMISSIONS = [
    {"key": "announcement.post.create", "display_name": "공지사항 작성", "category": "공지사항"},
    {"key": "announcement.post.edit", "display_name": "공지사항 수정 (본인 또는 관리자)", "category": "공지사항"},
    {"key": "announcement.post.delete", "display_name": "공지사항 삭제 (본인 또는 관리자)", "category": "공지사항"},
    {"key": "announcement.post.view", "display_name": "공지사항 열람", "category": "공지사항"},
]
