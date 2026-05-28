"""과거 학생 연구 보고서 모듈 진입점.

sub-module 분할 (student_self 패턴):
- _helpers.py — to_item, active_semester_id, UPLOAD_DIR 등 공통
- browse.py — list + facets (모든 인증 사용자)
- admin_bulk.py — ZIP 일괄 업로드 + 삭제 (관리자)
- student_flow.py — 학생 자가 업로드 + 본인 supervisor 조회
- review.py — 교사 승인/거부 + 본인 pending 큐
- supervision.py — 담당교사 매핑 CRUD + CSV 일괄 + 본인 담당 학생

본 파일은 APIRouter() 생성 + sub-module import만. sub-module이 부모 router를
직접 import해 @router.get(...) 데코레이터 적용 → endpoint 등록.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/past-research", tags=["past-research"])


# Sub-module endpoint 등록 강제 — 마지막에 import해 circular 회피.
# 각 sub-module이 from app.modules.past_research.router import router 로
# 이 router 변수를 가져가 @router decorator 적용.
from app.modules.past_research import browse  # noqa: E402, F401
from app.modules.past_research import admin_bulk  # noqa: E402, F401
from app.modules.past_research import student_flow  # noqa: E402, F401
from app.modules.past_research import review  # noqa: E402, F401
from app.modules.past_research import supervision  # noqa: E402, F401
