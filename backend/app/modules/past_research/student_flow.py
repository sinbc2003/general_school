"""학생 자가 업로드 + 본인 supervisor 조회."""

import json
import os
import uuid
from pathlib import Path

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import POLICY_DOCUMENT, validate_upload
from app.models.past_research import PastResearch
from app.models.research_supervision import ResearchSupervision
from app.models.user import User
from app.modules.past_research._helpers import UPLOAD_DIR, active_semester_id
from app.modules.past_research.parser import make_standard_filename
from app.modules.past_research.router import router
from app.modules.past_research.schemas import StudentSubmitMeta
from app.services.notification import notify_users


@router.post("/_submit")
async def student_submit(
    file: UploadFile = File(...),
    meta: str = Form(..., description="JSON: {year, grade, semester, report_type, fields, title, is_excellent}"),
    user: User = Depends(require_permission("past_research.submit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학생 본인 연구 보고서 업로드 → pending + 담당교사 알림."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용 endpoint")

    try:
        meta_dict = json.loads(meta)
        m = StudentSubmitMeta(**meta_dict)
    except Exception as e:
        raise HTTPException(400, f"meta 파싱 실패: {e}")

    data = await validate_upload(file, POLICY_DOCUMENT)
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "PDF 파일만 업로드 가능합니다")

    semester_id = await active_semester_id(db)
    supervisor_id: int | None = None
    if semester_id:
        sup = (await db.execute(
            select(ResearchSupervision).where(
                ResearchSupervision.semester_id == semester_id,
                ResearchSupervision.student_id == user.id,
            )
        )).scalar_one_or_none()
        if sup:
            supervisor_id = sup.supervisor_id
    if not supervisor_id:
        raise HTTPException(
            400,
            "담당 교사가 지정되지 않았습니다. 관리자 또는 담당 교사에게 등록을 요청하세요.",
        )

    await ensure_dir_async(Path(UPLOAD_DIR))
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.pdf")
    await write_bytes_async(Path(stored_path), data)

    standard_name = make_standard_filename(
        m.year, m.grade, m.semester, m.report_type, m.fields, m.title, m.is_excellent,
    )
    row = PastResearch(
        year=m.year,
        grade=m.grade,
        semester=m.semester,
        report_type=m.report_type,
        fields=m.fields,
        title=m.title,
        is_excellent=m.is_excellent,
        original_filename=standard_name,
        stored_path=stored_path,
        file_size=len(data),
        uploaded_by_id=user.id,
        submitted_by_student_id=user.id,
        supervisor_id=supervisor_id,
        status="pending",
    )
    db.add(row)
    await db.flush()

    await notify_users(
        db,
        user_ids=[supervisor_id],
        type="past_research.submitted",
        title=f"{user.name} 학생이 연구 보고서를 제출했습니다",
        body=m.title[:200],
        link_url="/research-review",
        source_user_id=user.id,
        meta={"past_research_id": row.id, "student_id": user.id},
    )

    await log_action(db, user, "past_research.submit", f"id={row.id}", request=request)
    return {"id": row.id, "status": row.status, "standard_filename": standard_name}


@router.get("/_my/supervisor")
async def my_supervisor(
    user: User = Depends(require_permission("past_research.submit")),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인의 담당 교사 (현재 학기)."""
    semester_id = await active_semester_id(db)
    if not semester_id:
        return {"supervisor": None, "semester_id": None}
    sup = (await db.execute(
        select(ResearchSupervision, User.name).join(
            User, User.id == ResearchSupervision.supervisor_id,
        ).where(
            ResearchSupervision.semester_id == semester_id,
            ResearchSupervision.student_id == user.id,
        )
    )).first()
    if not sup:
        return {"supervisor": None, "semester_id": semester_id}
    row, name = sup
    return {
        "supervisor": {"id": row.supervisor_id, "name": name, "topic_title": row.topic_title},
        "semester_id": semester_id,
    }
