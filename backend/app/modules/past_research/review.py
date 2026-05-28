"""교사 승인/거부 + 본인 pending 큐."""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.past_research import PastResearch
from app.models.user import User
from app.modules.past_research._helpers import to_item
from app.modules.past_research.router import router
from app.modules.past_research.schemas import ReviewReq
from app.services.notification import notify_users
from app.services.student_artifact_sync import ensure_student_artifact


@router.patch("/{rid}/_review")
async def review_submission(
    rid: int,
    body: ReviewReq,
    user: User = Depends(require_permission("past_research.review")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """담당 교사가 학생 제출 보고서 승인/거부.

    승인 시 StudentArtifact 자동 생성.
    """
    row = (await db.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    if row.status != "pending":
        raise HTTPException(409, f"이미 처리된 보고서 (status={row.status})")

    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and row.supervisor_id != user.id:
        raise HTTPException(403, "담당 교사만 승인할 수 있습니다")

    row.status = body.status
    row.reviewed_at = datetime.now(timezone.utc)
    row.rejection_reason = body.rejection_reason if body.status == "rejected" else None

    if body.status == "approved" and row.submitted_by_student_id:
        artifact_id = await ensure_student_artifact(
            db,
            student_id=row.submitted_by_student_id,
            title=row.title,
            description=f"{row.year}년 {row.grade}학년 {row.semester}학기 {row.report_type}",
            category="report",
            file_url="/" + row.stored_path.replace("\\", "/"),
            file_name=row.original_filename,
            file_size=row.file_size,
            tags=list(row.fields or []),
            existing_id=row.student_artifact_id,
        )
        if artifact_id:
            row.student_artifact_id = artifact_id

    await db.flush()

    if row.submitted_by_student_id:
        if body.status == "approved":
            await notify_users(
                db,
                user_ids=[row.submitted_by_student_id],
                type="past_research.approved",
                title="연구 보고서가 승인되었습니다",
                body=f"{row.title} — 학생 산출물 갤러리에 등록되었습니다",
                link_url="/s/past-research",
                source_user_id=user.id,
                meta={"past_research_id": row.id},
            )
        else:
            await notify_users(
                db,
                user_ids=[row.submitted_by_student_id],
                type="past_research.rejected",
                title="연구 보고서가 반려되었습니다",
                body=body.rejection_reason or "사유 미기재",
                link_url="/s/research-submit",
                source_user_id=user.id,
                meta={"past_research_id": row.id, "reason": body.rejection_reason},
            )

    await log_action(
        db, user, f"past_research.{body.status}", f"id={rid}", request=request,
        is_sensitive=True,
    )
    return {"ok": True, "status": row.status}


@router.get("/_my/pending")
async def my_pending_reviews(
    user: User = Depends(require_permission("past_research.review")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 supervisor인 학생들의 pending 보고서 list."""
    q = select(PastResearch, User.name).join(
        User, User.id == PastResearch.submitted_by_student_id, isouter=True,
    ).where(
        PastResearch.status == "pending",
        PastResearch.supervisor_id == user.id,
    ).order_by(PastResearch.created_at.desc())
    rows = (await db.execute(q)).all()
    return {"items": [to_item(p, name) for p, name in rows]}
