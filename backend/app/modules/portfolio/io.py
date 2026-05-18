"""포트폴리오 CSV import/export endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import io'로 등록.
"""

from fastapi import Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.portfolio import (
    StudentAward, StudentCounseling, StudentGrade, StudentMockExam, StudentRecord,
)
from app.models.user import User
from app.modules.portfolio.router import router
from app.services.portfolio_io import (
    CSV_TEMPLATES, export_csv, import_csv, template_csv,
)


@router.get("/_io/csv-template/{csv_type}")
async def csv_template(
    csv_type: str,
    user: User = Depends(require_permission("portfolio.grade.view")),
):
    """빈 CSV 템플릿 다운로드"""
    if csv_type not in CSV_TEMPLATES:
        raise HTTPException(400, f"unknown type. valid: {list(CSV_TEMPLATES.keys())}")
    content = template_csv(csv_type)
    return Response(
        content="﻿" + content,  # BOM for Excel
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="template_{csv_type}.csv"'},
    )


@router.post("/_io/import/{csv_type}")
async def import_portfolio_csv(
    csv_type: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    request: Request = None,
    user: User = Depends(require_permission("portfolio.grade.edit")),
    db: AsyncSession = Depends(get_db),
):
    """CSV 일괄 업로드 (dry_run=true로 검증만 가능)"""
    if csv_type not in CSV_TEMPLATES:
        raise HTTPException(400, f"unknown type. valid: {list(CSV_TEMPLATES.keys())}")
    from app.core.upload import validate_upload, POLICY_CSV
    raw = await validate_upload(file, POLICY_CSV)
    result = await import_csv(db, csv_type, raw, dry_run=dry_run)
    if not dry_run:
        await log_action(db, user, f"portfolio.import.{csv_type}",
                         f"ok={result['ok_count']}, errors={len(result['errors'])}",
                         request=request, is_sensitive=True)
    return result


@router.get("/{sid}/export.csv")
async def export_student_csv(
    sid: int,
    types: str = Query("grades,awards,mockexam,counseling,records"),
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 단일 데이터 CSV 묶음 (각 type 섹션)"""
    await assert_can_view_student(db, user, sid)
    type_list = [t.strip() for t in types.split(",") if t.strip() in CSV_TEMPLATES]

    parts: list[str] = []
    for t in type_list:
        if t == "grades":
            rows = (await db.execute(select(StudentGrade).where(StudentGrade.student_id == sid))).scalars().all()
        elif t == "awards":
            rows = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
        elif t == "mockexam":
            rows = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()
        elif t == "counseling":
            rows = (await db.execute(select(StudentCounseling).where(StudentCounseling.student_id == sid))).scalars().all()
        elif t == "records":
            rows = (await db.execute(select(StudentRecord).where(StudentRecord.student_id == sid))).scalars().all()
        else:
            continue
        parts.append(f"# {t}\n" + export_csv(rows, t))

    content = "\n\n".join(parts) if parts else ""
    return Response(
        content="﻿" + content, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="student_{sid}_export.csv"'},
    )
