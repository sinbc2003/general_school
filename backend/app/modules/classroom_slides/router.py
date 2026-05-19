"""클래스룸 프리젠테이션 라우터 — sub-module 패턴.

경로 요약:
  CRUD: GET / POST / GET{did} / PUT{did} / DELETE{did}
  슬라이드: POST /{did}/slides, PUT /slides/{sid}, DELETE /slides/{sid},
           POST /{did}/slides/_reorder
  멤버: GET/POST /{did}/members, DELETE /{did}/members/{uid}
  Hocuspocus: GET /{did}/permission, GET·POST /{did}/yjs-snapshot

deck 단위 Y.Doc 1개 — Hocuspocus documentName = "deck-{did}".
각 슬라이드 본문은 같은 Y.Doc 안의 fragment("slide-{sid}").
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/classroom/decks", tags=["classroom-decks"])

# Sub-modules — endpoint 등록 강제. 마지막에 import해 순환 회피.
from app.modules.classroom_slides import crud  # noqa: E402, F401
from app.modules.classroom_slides import slides  # noqa: E402, F401
from app.modules.classroom_slides import members  # noqa: E402, F401
from app.modules.classroom_slides import hocuspocus  # noqa: E402, F401
