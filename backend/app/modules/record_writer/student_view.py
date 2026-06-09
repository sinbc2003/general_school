"""생기부 확정·공개 (교사) + 학생 본인 열람.

- 교사가 학생별 is_published 토글 → 학생이 본인 화면에서 열람 가능.
- 학생은 본인이 포함된 published 프로젝트의 항목별 생성 결과만 읽기 전용 조회.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProject,
    RecordProjectStudent,
)
from app.models.user import User
from app.modules.record_writer._helpers import get_owned_project
from app.modules.record_writer.router import router
from app.modules.record_writer.schemas import PublishReq


@router.post("/projects/{pid}/students/{student_id}/publish")
async def toggle_publish(
    pid: int,
    student_id: int,
    body: PublishReq,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학생별 생기부 공개/비공개 — 공개 시 학생 본인이 열람 가능."""
    await get_owned_project(db, user, pid)
    rps = (
        await db.execute(
            select(RecordProjectStudent).where(
                RecordProjectStudent.project_id == pid,
                RecordProjectStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if not rps:
        raise HTTPException(404, "이 프로젝트의 학생이 아닙니다")
    rps.is_published = body.published
    await log_action(
        db, user, "record.publish",
        detail=f"생기부 #{pid} 학생 {student_id} {'공개' if body.published else '비공개'}",
        is_sensitive=True,
    )
    await db.commit()
    return {"is_published": rps.is_published}


@router.get("/me/records")
async def my_records(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 — 공개된 생기부의 항목별 생성 결과 (읽기 전용)."""
    rows = (
        await db.execute(
            select(RecordProjectStudent, RecordProject)
            .join(RecordProject, RecordProject.id == RecordProjectStudent.project_id)
            .where(
                RecordProjectStudent.student_id == user.id,
                RecordProjectStudent.is_published == True,  # noqa: E712
                RecordProject.deleted_at.is_(None),
            )
            .order_by(RecordProject.created_at.desc())
        )
    ).all()
    result = []
    for rps, proj in rows:
        cols = (
            await db.execute(
                select(RecordColumn)
                .where(RecordColumn.project_id == proj.id)
                .order_by(RecordColumn.display_order)
            )
        ).scalars().all()
        cells = {
            c.column_id: c
            for c in (
                await db.execute(
                    select(RecordCell).where(
                        RecordCell.project_id == proj.id,
                        RecordCell.student_id == user.id,
                    )
                )
            ).scalars().all()
        }
        items = []
        for col in cols:
            cell = cells.get(col.id)
            txt = (cell.generated_text if cell else "") or ""
            if txt.strip():
                items.append({"name": col.name, "content": txt, "char_count": len(txt)})
        if items or rps.final_text:
            result.append(
                {
                    "project_id": proj.id,
                    "project": proj.name,
                    "final_text": rps.final_text,
                    "items": items,
                }
            )
    return result
