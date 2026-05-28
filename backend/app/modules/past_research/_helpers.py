"""Past research 공통 헬퍼 — sub-module들이 공유."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.files import DEFAULT_STORAGE_ROOT
from app.models.past_research import PastResearch
from app.models.timetable import Semester

# settings.STORAGE_ROOT 기반 (Phase 2-Q 통합).
UPLOAD_DIR = str(DEFAULT_STORAGE_ROOT / "past_research")
MAX_PDFS_PER_ZIP = 2000
MAX_PDF_SIZE = 50 * 1024 * 1024  # 50MB per PDF


def to_item(p: PastResearch, submitter_name: str | None = None) -> dict:
    return {
        "id": p.id,
        "year": p.year,
        "grade": p.grade,
        "semester": p.semester,
        "report_type": p.report_type,
        "fields": list(p.fields or []),
        "title": p.title,
        "is_excellent": p.is_excellent,
        "original_filename": p.original_filename,
        "file_size": p.file_size,
        "file_url": "/" + p.stored_path.replace("\\", "/"),
        "status": p.status,
        "submitted_by_student_id": p.submitted_by_student_id,
        "submitted_by_name": submitter_name,
        "supervisor_id": p.supervisor_id,
        "rejection_reason": p.rejection_reason,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


async def active_semester_id(db: AsyncSession) -> int | None:
    sem = (await db.execute(
        select(Semester).where(Semester.is_current == True).order_by(Semester.id.desc())
    )).scalar_one_or_none()
    return sem.id if sem else None
