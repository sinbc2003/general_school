"""학생 산출물 제출 + 교사 승인 + 본인 큐."""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import POLICY_CLASSROOM, validate_upload
from app.models.teacher_group import (
    GroupSubmission, TeacherGroup, TeacherGroupStudent,
)
from app.models.user import User
from app.modules.teacher_groups._helpers import UPLOAD_DIR, is_admin
from app.modules.teacher_groups.router import router
from app.modules.teacher_groups.schemas import SubmissionReviewReq
from app.services.notification import notify_users
from app.services.student_artifact_sync import ensure_student_artifact


@router.post("/{gid}/_submissions")
async def submit_to_group(
    gid: int,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1),
    description: str | None = Form(None),
    user: User = Depends(require_permission("teacher_group.submit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학생이 본인이 속한 그룹에 산출물 제출."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용")
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    assignment = (await db.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == gid,
            TeacherGroupStudent.student_id == user.id,
        )
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(403, "본인이 등록되지 않은 그룹입니다")

    data = await validate_upload(file, POLICY_CLASSROOM)
    await ensure_dir_async(Path(UPLOAD_DIR))
    ext = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    await write_bytes_async(Path(stored_path), data)

    sub = GroupSubmission(
        group_id=gid,
        student_id=user.id,
        title=title.strip(),
        description=description,
        file_url="/" + stored_path.replace("\\", "/"),
        file_name=file.filename or stored_path,
        file_size=len(data),
        status="pending",
    )
    db.add(sub)
    await db.flush()

    await notify_users(
        db, user_ids=[assignment.assigned_teacher_id],
        type="group_submission.submitted",
        title=f"{user.name} 학생이 '{g.name}' 산출물을 제출했습니다",
        body=title[:200],
        link_url="/research-review",
        source_user_id=user.id,
        meta={"group_id": gid, "submission_id": sub.id},
    )
    await log_action(db, user, "teacher_group.submit",
                     f"group={gid} sub={sub.id}", request=request)
    return {"id": sub.id, "status": sub.status}


@router.get("/{gid}/_submissions")
async def list_group_submissions(
    gid: int,
    user: User = Depends(require_permission("teacher_group.view")),
    db: AsyncSession = Depends(get_db),
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    rows = (await db.execute(
        select(GroupSubmission, User).join(User, User.id == GroupSubmission.student_id)
        .where(GroupSubmission.group_id == gid)
        .order_by(GroupSubmission.created_at.desc())
    )).all()
    return {
        "items": [
            {
                "id": s.id, "group_id": s.group_id,
                "student_id": s.student_id, "student_name": u.name, "student_username": u.username,
                "title": s.title, "description": s.description,
                "file_url": s.file_url, "file_name": s.file_name, "file_size": s.file_size,
                "status": s.status, "reviewed_by_id": s.reviewed_by_id,
                "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
                "rejection_reason": s.rejection_reason,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, u in rows
        ],
    }


@router.patch("/_submissions/{sid}/_review")
async def review_group_submission(
    sid: int,
    body: SubmissionReviewReq,
    user: User = Depends(require_permission("teacher_group.review")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sub = await db.get(GroupSubmission, sid)
    if not sub:
        raise HTTPException(404)
    if sub.status != "pending":
        raise HTTPException(409, f"이미 처리됨 (status={sub.status})")

    assignment = (await db.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == sub.group_id,
            TeacherGroupStudent.student_id == sub.student_id,
        )
    )).scalar_one_or_none()
    if not is_admin(user) and (not assignment or assignment.assigned_teacher_id != user.id):
        raise HTTPException(403, "담당 교사만 승인할 수 있습니다")

    sub.status = body.status
    sub.reviewed_by_id = user.id
    sub.reviewed_at = datetime.now(timezone.utc)
    sub.rejection_reason = body.rejection_reason if body.status == "rejected" else None

    if body.status == "approved":
        g = await db.get(TeacherGroup, sub.group_id)
        artifact_id = await ensure_student_artifact(
            db,
            student_id=sub.student_id,
            title=sub.title,
            description=f"{g.name if g else '그룹'} 산출물",
            category="report",
            file_url=sub.file_url,
            file_name=sub.file_name,
            file_size=sub.file_size,
            tags=[g.name] if g else [],
            existing_id=sub.student_artifact_id,
        )
        if artifact_id:
            sub.student_artifact_id = artifact_id

    await db.flush()

    if body.status == "approved":
        await notify_users(
            db, user_ids=[sub.student_id],
            type="group_submission.approved",
            title="그룹 산출물이 승인되었습니다",
            body=sub.title,
            link_url="/s/my-portfolio",
            source_user_id=user.id,
            meta={"submission_id": sub.id},
        )
    else:
        await notify_users(
            db, user_ids=[sub.student_id],
            type="group_submission.rejected",
            title="그룹 산출물이 반려되었습니다",
            body=body.rejection_reason or "사유 미기재",
            link_url="/s/my-activities",
            source_user_id=user.id,
            meta={"submission_id": sub.id, "reason": body.rejection_reason},
        )

    await log_action(
        db, user, f"group_submission.{body.status}", f"id={sid}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "status": sub.status}


@router.get("/_my/pending")
async def my_pending_group_submissions(
    user: User = Depends(require_permission("teacher_group.review")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 담당 교사인 학생들의 pending 그룹 산출물."""
    rows = (await db.execute(
        select(GroupSubmission, User, TeacherGroup).join(
            User, User.id == GroupSubmission.student_id,
        ).join(
            TeacherGroup, TeacherGroup.id == GroupSubmission.group_id,
        ).join(
            TeacherGroupStudent, and_(
                TeacherGroupStudent.group_id == GroupSubmission.group_id,
                TeacherGroupStudent.student_id == GroupSubmission.student_id,
            ),
        ).where(
            GroupSubmission.status == "pending",
            TeacherGroupStudent.assigned_teacher_id == user.id,
        ).order_by(GroupSubmission.created_at.desc())
    )).all()
    return {
        "items": [
            {
                "id": s.id, "group_id": s.group_id, "group_name": g.name,
                "student_id": s.student_id, "student_name": u.name, "student_username": u.username,
                "title": s.title, "description": s.description,
                "file_url": s.file_url, "file_name": s.file_name, "file_size": s.file_size,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, u, g in rows
        ],
    }


@router.get("/_my/student-activities")
async def my_activities(
    user: User = Depends(require_permission("teacher_group.submit")),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 속한 모든 그룹 + 본인 산출물 list."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용")
    assignments = (await db.execute(
        select(TeacherGroupStudent, TeacherGroup, User).join(
            TeacherGroup, TeacherGroup.id == TeacherGroupStudent.group_id,
        ).join(
            User, User.id == TeacherGroupStudent.assigned_teacher_id,
        ).where(TeacherGroupStudent.student_id == user.id)
    )).all()

    group_ids = [a.group_id for a, _, _ in assignments]
    subs_by_group: dict[int, list] = {}
    if group_ids:
        all_subs = (await db.execute(
            select(GroupSubmission).where(
                GroupSubmission.group_id.in_(group_ids),
                GroupSubmission.student_id == user.id,
            )
        )).scalars().all()
        for s in all_subs:
            subs_by_group.setdefault(s.group_id, []).append({
                "id": s.id, "title": s.title, "status": s.status,
                "file_url": s.file_url, "file_name": s.file_name,
                "rejection_reason": s.rejection_reason,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })

    return {
        "items": [
            {
                "group_id": g.id, "group_name": g.name, "type": g.type,
                "description": g.description,
                "teacher_id": t.id, "teacher_name": t.name,
                "submissions": subs_by_group.get(g.id, []),
            }
            for a, g, t in assignments
        ],
    }
