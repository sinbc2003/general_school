"""제출 → 생기부 셀 자동 반영 (push).

학생이 과제 제출/설문 응답하는 순간, 그 과제·설문이 데이터 소스로 연결된 생기부
항목(RecordColumn.source_config)을 찾아 해당 학생의 셀 raw_data를 자동으로 채운다.
교사가 '자동 수집' 버튼을 누르지 않아도 변환 준비가 끝나 있도록.

best-effort background task — 제출 흐름을 막지 않으며, 자체 DB session을 쓴다.
제출 트랜잭션 commit 이후 실행되도록 짧게 sleep 후 수집한다.
"""

import asyncio
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.student_record_project import (
    RecordColumn,
    RecordProject,
    RecordProjectStudent,
)

log = logging.getLogger(__name__)


async def _autocollect(source_type: str, ref_id: int | None, student_id: int) -> None:
    # 제출 endpoint(get_db)의 commit 이후 실행되도록 잠깐 대기
    await asyncio.sleep(2)
    from app.modules.record_writer.collect import collect_into_cells

    async with async_session_factory() as db:
        try:
            cols = (
                await db.execute(
                    select(RecordColumn).where(RecordColumn.source_config.isnot(None))
                )
            ).scalars().all()
            touched = False
            for col in cols:
                cfg = col.source_config or {}
                if cfg.get("type") != source_type:
                    continue
                if source_type == "assignment" and cfg.get("assignment_id") != ref_id:
                    continue
                if source_type == "survey" and cfg.get("survey_id") != ref_id:
                    continue
                proj = await db.get(RecordProject, col.project_id)
                if not proj or proj.deleted_at is not None:
                    continue
                in_proj = (
                    await db.execute(
                        select(RecordProjectStudent.id).where(
                            RecordProjectStudent.project_id == col.project_id,
                            RecordProjectStudent.student_id == student_id,
                        )
                    )
                ).scalar_one_or_none()
                if not in_proj:
                    continue
                n = await collect_into_cells(db, proj, col, [student_id])
                if n:
                    touched = True
            if touched:
                await db.commit()
        except Exception:
            log.exception(
                "record autocollect failed (%s ref=%s student=%s)",
                source_type, ref_id, student_id,
            )


def schedule_autocollect(source_type: str, ref_id: int | None, student_id: int) -> None:
    """제출 endpoint에서 호출 — background task로 생기부 자동 수집을 예약."""
    try:
        asyncio.create_task(_autocollect(source_type, ref_id, student_id))
    except RuntimeError:
        # 실행 중인 이벤트 루프 없음(테스트 등) — 조용히 skip
        pass
