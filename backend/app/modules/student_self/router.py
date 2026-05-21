"""학생 본인 전용 라우터 — 산출물 업로드, 진로 설계, 과거 연구 열람, 제출물 통합.

분할 구조 (sub-router 패턴):
- _helpers.py — _require_student, _artifact_to_dict, _plan_to_dict
- artifacts.py — 산출물 CRUD + 공개 갤러리 (5 endpoint)
- career_plans.py — 진로/진학 설계 (7 endpoint)
- discovery.py — 과거 연구 열람 + 대시보드 통계 (2 endpoint)
- submissions.py — 과제·동아리 제출물 + 통합 timeline (6 endpoint)

본 파일은 APIRouter() 생성과 sub-module 등록만 담당.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/me", tags=["student_self"])


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.student_self import artifacts  # noqa: E402, F401
from app.modules.student_self import career_plans  # noqa: E402, F401
from app.modules.student_self import discovery  # noqa: E402, F401
from app.modules.student_self import submissions  # noqa: E402, F401
from app.modules.student_self import enrollment  # noqa: E402, F401
