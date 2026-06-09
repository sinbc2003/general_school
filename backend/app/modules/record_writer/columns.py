"""생기부 항목(열) CRUD + 매트릭스 전체 조회."""

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProjectStudent,
)
from app.models.user import User
from app.modules.record_writer._helpers import (
    cell_to_dict,
    column_to_dict,
    get_owned_project,
    project_to_dict,
)
from app.modules.record_writer.router import router
from app.modules.record_writer.schemas import ColumnCreate, ColumnUpdate


@router.get("/projects/{pid}/full")
async def get_project_full(
    pid: int,
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    """매트릭스 한 번에: 프로젝트 + 학생(행) + 항목(열) + 셀."""
    p = await get_owned_project(db, user, pid)
    srows = (
        await db.execute(
            select(RecordProjectStudent, User.name)
            .join(User, User.id == RecordProjectStudent.student_id)
            .where(RecordProjectStudent.project_id == pid)
            .order_by(RecordProjectStudent.display_order)
        )
    ).all()
    students = [
        {
            "id": r.id,
            "student_id": r.student_id,
            "name": name,
            "display_order": r.display_order,
            "is_published": r.is_published,
            "final_text": r.final_text,
        }
        for r, name in srows
    ]
    cols = (
        await db.execute(
            select(RecordColumn)
            .where(RecordColumn.project_id == pid)
            .order_by(RecordColumn.display_order)
        )
    ).scalars().all()
    columns = [column_to_dict(c) for c in cols]
    cell_rows = (
        await db.execute(select(RecordCell).where(RecordCell.project_id == pid))
    ).scalars().all()
    # key = "{column_id}:{student_id}"
    cells = {f"{c.column_id}:{c.student_id}": cell_to_dict(c) for c in cell_rows}
    return {
        **project_to_dict(p),
        "students": students,
        "columns": columns,
        "cells": cells,
    }


@router.post("/projects/{pid}/columns")
async def create_column(
    pid: int,
    body: ColumnCreate,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    await get_owned_project(db, user, pid)
    max_order = (
        await db.execute(
            select(func.max(RecordColumn.display_order)).where(
                RecordColumn.project_id == pid
            )
        )
    ).scalar() or 0
    c = RecordColumn(
        project_id=pid,
        name=body.name,
        display_order=max_order + 1,
        system_prompt=body.system_prompt,
        source_config=body.source_config,
        char_min=body.char_min,
        char_max=body.char_max,
        kind=body.kind if body.kind in ("normal", "summary") else "normal",
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return column_to_dict(c)


async def _get_owned_column(db: AsyncSession, user: User, cid: int) -> RecordColumn:
    c = await db.get(RecordColumn, cid)
    if not c:
        raise HTTPException(404, "항목을 찾을 수 없습니다")
    await get_owned_project(db, user, c.project_id)  # 소유 가드
    return c


@router.put("/columns/{cid}")
async def update_column(
    cid: int,
    body: ColumnUpdate,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await _get_owned_column(db, user, cid)
    if body.name is not None:
        c.name = body.name
    if body.system_prompt is not None:
        c.system_prompt = body.system_prompt
    if body.source_config is not None:
        c.source_config = body.source_config
    if body.char_min is not None:
        c.char_min = body.char_min
    if body.char_max is not None:
        c.char_max = body.char_max
    if body.kind is not None and body.kind in ("normal", "summary"):
        c.kind = body.kind
    await db.commit()
    await db.refresh(c)
    return column_to_dict(c)


@router.delete("/columns/{cid}")
async def delete_column(
    cid: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await _get_owned_column(db, user, cid)
    await db.delete(c)  # 셀 cascade
    await db.commit()
    return {"ok": True}
