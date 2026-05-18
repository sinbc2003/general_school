"""사용자 관리 라우터 — CRUD + 세션 + 일괄 등록 + 학년 진급/졸업.

분할 구조 (sub-router 패턴):
- _helpers.py — 공유 가드(_is_admin, _ensure_not_last_super_admin) + 직렬화 + 상수
- crud.py — list/create/update/delete (CRUD 4 endpoint)
- sessions.py — 세션 목록/강제 로그아웃 + 비밀번호 리셋 (3 endpoint)
- bulk.py — Excel 양식·import·export + CSV 일괄 등록 (6 endpoint)
- cohort.py — 학년 진급·졸업·졸업생 목록 (3 endpoint)

본 파일은 APIRouter() 생성과 sub-module 등록만 담당.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/users", tags=["users"])


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
# 등록 순서가 라우트 매칭 우선순위에 영향: /_cohort, /_csv, /excel-template 같은
# 다세그먼트 path를 먼저 등록해 /{user_id}와 충돌 안 함.
from app.modules.users import bulk  # noqa: E402, F401
from app.modules.users import cohort  # noqa: E402, F401
from app.modules.users import sessions  # noqa: E402, F401
from app.modules.users import crud  # noqa: E402, F401
