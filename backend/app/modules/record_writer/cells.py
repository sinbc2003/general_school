"""생기부 셀 편집 (수동 입력 / AI 제안 수락)."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProjectStudent,
)
from app.models.user import User
from app.modules.record_writer._helpers import cell_to_dict, get_owned_project
from app.modules.record_writer.router import router
from app.modules.record_writer.schemas import CellUpsert


@router.put("/cells")
async def upsert_cell(
    body: CellUpsert,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """셀 생성/수정. (column, student) UNIQUE upsert."""
    await get_owned_project(db, user, body.project_id)

    # 열·학생이 이 프로젝트 소속인지 검증 (IDOR 방어)
    col = await db.get(RecordColumn, body.column_id)
    if not col or col.project_id != body.project_id:
        raise HTTPException(404, "항목을 찾을 수 없습니다")
    in_proj = (
        await db.execute(
            select(RecordProjectStudent.id).where(
                RecordProjectStudent.project_id == body.project_id,
                RecordProjectStudent.student_id == body.student_id,
            )
        )
    ).scalar_one_or_none()
    if not in_proj:
        raise HTTPException(404, "이 프로젝트의 학생이 아닙니다")

    cell = (
        await db.execute(
            select(RecordCell).where(
                RecordCell.column_id == body.column_id,
                RecordCell.student_id == body.student_id,
            )
        )
    ).scalar_one_or_none()
    if not cell:
        cell = RecordCell(
            project_id=body.project_id,
            column_id=body.column_id,
            student_id=body.student_id,
        )
        db.add(cell)

    if body.raw_data is not None:
        cell.raw_data = body.raw_data
    if body.generated_text is not None:
        cell.generated_text = body.generated_text

    if body.status is not None:
        cell.status = body.status
    else:
        # 자동 상태: generated 있으면 generated, raw만 있으면 collected
        if cell.generated_text:
            cell.status = "generated"
        elif cell.raw_data:
            cell.status = "collected"
        else:
            cell.status = "empty"

    await db.commit()
    await db.refresh(cell)
    return cell_to_dict(cell)
