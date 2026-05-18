"""시간표 라우터 — 학기, 학기 명단(enrollment), 시간표 항목"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_current_semester, get_semester_by_id_or_404
from app.models.timetable import Semester, TimetableEntry, SemesterEnrollment
from app.models.user import User
from app.modules.timetable.schemas import (
    SemesterCreate,
    SemesterUpdate,
    SemesterStructureUpdate,
    EnrollmentCreate,
    EnrollmentUpdate,
    OnboardingSubmit,
    PromoteRequest,
)
from app.services.semester_import import (
    import_enrollments_csv,
    template_csv as semester_template_csv,
)

router = APIRouter(prefix="/api/timetable", tags=["timetable"])


def _safe_json_parse(s: str | None, default):
    """JSON 문자열 → Python 객체. 실패 시 default."""
    if not s:
        return default
    import json
    try:
        return json.loads(s)
    except Exception:
        return default


def _semester_to_dict(s: Semester) -> dict:
    return {
        "id": s.id, "year": s.year, "semester": s.semester,
        "name": s.name,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "end_date": s.end_date.isoformat() if s.end_date else None,
        "is_current": s.is_current,
        "is_archived": s.is_archived,
        "archived_at": s.archived_at.isoformat() if s.archived_at else None,
        # 학교 구조 (드롭다운 용도)
        "classes_per_grade": _safe_json_parse(s.classes_per_grade, {}),
        "subjects": _safe_json_parse(s.subjects, []),
        "departments": _safe_json_parse(s.departments, []),
    }


async def _assert_semester_writable(db: AsyncSession, sid: int) -> Semester:
    """학기 쓰기 작업 전 archived 여부 검증. archived면 423 Locked."""
    s = await get_semester_by_id_or_404(db, sid)
    if s.is_archived:
        raise HTTPException(
            423,  # Locked
            f"학기 '{s.name}'은(는) 보관(archived) 상태입니다. 편집하려면 먼저 보관을 해제하세요.",
        )
    return s


def _parse_date(v: str | date | None) -> date | None:
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(str(v))




# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.timetable import semesters  # noqa: E402, F401
from app.modules.timetable import enrollments  # noqa: E402, F401
from app.modules.timetable import entries  # noqa: E402, F401
