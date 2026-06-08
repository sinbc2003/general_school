"""생활기록부 자동작성 모듈 진입점.

sub-module 분할 (past_research/student_self 패턴):
- _helpers.py — 프로젝트 가드, 직렬화, 범위→학생 매핑
- projects.py — 프로젝트 CRUD + 범위→학생 자동 행

본 파일은 APIRouter() 생성 + sub-module import만. sub-module이 부모 router를
직접 import해 @router.<method>(...) 데코레이터 적용 → endpoint 등록.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/record-writer", tags=["record-writer"])


# Sub-module endpoint 등록 — 마지막에 import해 circular 회피.
from app.modules.record_writer import projects  # noqa: E402, F401
from app.modules.record_writer import scope  # noqa: E402, F401
