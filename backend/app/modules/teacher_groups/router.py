"""교사 임시 그룹 (행사·대회·연구) 모듈 진입점.

sub-module 분할 (student_self 패턴):
- _helpers.py — 공통 헬퍼 (is_admin, is_department_lead, group_to_dict 등)
- groups.py — 그룹 CRUD
- members.py — 참여 교사 초대/제외
- students.py — 학생 배정 + 학번 검색
- submissions.py — 산출물 제출·승인 + 본인 큐
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/teacher-groups", tags=["teacher-groups"])


# Sub-module endpoint 등록 강제 — 마지막에 import해 circular 회피.
from app.modules.teacher_groups import groups  # noqa: E402, F401
from app.modules.teacher_groups import members  # noqa: E402, F401
from app.modules.teacher_groups import students  # noqa: E402, F401
from app.modules.teacher_groups import submissions  # noqa: E402, F401
