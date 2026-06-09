"""생기부 학생 간 유사도 검사 (표절·복붙 탐지) — n-gram 자카드."""

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_record_project import RecordCell, RecordColumn
from app.models.user import User
from app.modules.record_writer._helpers import get_owned_project
from app.modules.record_writer.router import router
from app.services.text_similarity import max_pairwise_similarity

_MIN_LEN = 20  # 너무 짧은 셀은 비교 제외
_FLAG_THRESHOLD = 0.6


@router.post("/projects/{pid}/similarity")
async def compute_similarity(
    pid: int,
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 전체 — 각 열 안에서 학생 간 유사도 계산 → similarity_flag 갱신.

    같은 열(같은 항목) 안에서만 비교한다(다른 항목끼리는 무의미).
    셀 텍스트는 generated_text 우선, 없으면 raw_data.
    """
    await get_owned_project(db, user, pid)
    cols = (
        await db.execute(select(RecordColumn).where(RecordColumn.project_id == pid))
    ).scalars().all()
    all_cells = (
        await db.execute(select(RecordCell).where(RecordCell.project_id == pid))
    ).scalars().all()
    by_col: dict[int, list[RecordCell]] = {}
    for c in all_cells:
        by_col.setdefault(c.column_id, []).append(c)

    flagged = 0
    for col in cols:
        cells = by_col.get(col.id, [])
        items: list[tuple[int, str]] = []
        for c in cells:
            txt = (c.generated_text or c.raw_data or "").strip()
            if len(txt) >= _MIN_LEN:
                items.append((c.id, txt))
        sims = max_pairwise_similarity(items)
        for c in cells:
            s = sims.get(c.id)
            c.similarity_flag = round(s, 3) if s is not None else None
        flagged += sum(1 for c in cells if (c.similarity_flag or 0) >= _FLAG_THRESHOLD)
    await db.commit()
    return {"flagged": flagged, "threshold": _FLAG_THRESHOLD}
