"""클래스룸 협업 문서 라우터 — sub-module 패턴.

경로 요약:
  CRUD: GET / POST / GET{did} / PUT{did} / DELETE{did}
  멤버: GET/POST /{did}/members, DELETE /{did}/members/{uid}
  Hocuspocus: GET /{did}/permission, GET·POST /{did}/yjs-snapshot

분할:
  - _helpers.py: is_admin / doc_to_dict / resolve_permission / assert_can_read / archived 가드
  - crud.py: Document CRUD
  - members.py: DocumentMember 관리 (specific_users 모드)
  - hocuspocus.py: Hocuspocus 사이드카 연동 endpoint (permission + yjs-snapshot)
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/classroom/docs", tags=["classroom-docs"])

# Sub-modules — endpoint 등록 강제. 마지막에 import해 순환 회피.
from app.modules.classroom_docs import crud  # noqa: E402, F401
from app.modules.classroom_docs import members  # noqa: E402, F401
from app.modules.classroom_docs import hocuspocus  # noqa: E402, F401
