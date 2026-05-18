"""학생 본인 제출물 endpoints — 과제 제출물 + 동아리 산출물 + 통합 timeline.

본인 ownership 가드 (user_id == user.id) 모든 endpoint에서 적용.
교사 검토(reviewed) 후엔 학생 단독 삭제 차단 (무결성 보존).

router 객체는 router.py에서 공유. router.py 끝의 'from . import submissions'로 등록.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.student_self import StudentArtifact
from app.models.user import User
from app.modules.student_self.schemas import (
    ClubSubmissionUpdate, SubmissionPortfolioVisibility,
)

from app.modules.student_self.router import router


# ── 과제 제출물 ──

@router.get("/assignment-submissions")
async def my_assignment_submissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 제출한 과제 목록 + 노출 토글 상태."""
    from app.models.assignment import Assignment, AssignmentSubmission
    rows = (await db.execute(
        select(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .where(AssignmentSubmission.user_id == user.id)
        .order_by(desc(AssignmentSubmission.submitted_at))
    )).all()
    return {
        "items": [
            {
                "id": s.id,
                "assignment_id": s.assignment_id,
                "assignment_title": a.title,
                "subject": a.subject,
                "filename": s.filename,
                "file_size": s.file_size,
                "status": s.status.value if hasattr(s.status, "value") else s.status,
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "review_comment": s.review_comment,
                "show_in_portfolio": bool(s.show_in_portfolio),
            }
            for s, a in rows
        ]
    }


@router.put("/assignment-submissions/{sub_id}/portfolio-visibility")
async def toggle_submission_portfolio_visibility(
    sub_id: int,
    body: SubmissionPortfolioVisibility,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 제출물의 포트폴리오 노출 토글.

    show_in_portfolio=True면 /students/artifacts-gallery 공개 갤러리,
    PDF 생기부 등에 자동 포함.
    """
    from app.models.assignment import AssignmentSubmission
    s = (await db.execute(
        select(AssignmentSubmission).where(
            AssignmentSubmission.id == sub_id,
            AssignmentSubmission.user_id == user.id,  # 본인만
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 제출물만 토글 가능합니다")
    s.show_in_portfolio = bool(body.show_in_portfolio)
    await db.flush()
    return {"id": s.id, "show_in_portfolio": s.show_in_portfolio}


@router.delete("/assignment-submissions/{sub_id}")
async def delete_my_assignment_submission(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 제출한 과제를 삭제 (마감 전이거나 reviewed 전인 경우만).

    교사가 이미 검토(reviewed)한 제출물은 무결성을 위해 학생 단독 삭제 차단.
    """
    from app.models.assignment import AssignmentSubmission, SubmissionStatus
    s = (await db.execute(
        select(AssignmentSubmission).where(
            AssignmentSubmission.id == sub_id,
            AssignmentSubmission.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 제출물만 삭제 가능합니다")
    if s.status in (SubmissionStatus.REVIEWED, SubmissionStatus.ACCEPTED, SubmissionStatus.REJECTED):
        raise HTTPException(400, "이미 교사가 검토한 제출물은 삭제할 수 없습니다 (교사에게 요청하세요)")
    await db.delete(s)
    await db.flush()
    return {"ok": True, "id": sub_id}


# ── 동아리 산출물 ──

@router.put("/club-submissions/{sub_id}")
async def update_my_club_submission(
    sub_id: int,
    body: ClubSubmissionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 동아리 산출물의 메타(제목/유형) 수정."""
    from app.models.club import ClubSubmission
    s = (await db.execute(
        select(ClubSubmission).where(
            ClubSubmission.id == sub_id,
            ClubSubmission.author_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 산출물만 수정 가능합니다")
    patch = body.model_dump(exclude_unset=True)
    if "title" in patch and patch["title"] is not None:
        s.title = patch["title"].strip()
    if "submission_type" in patch and patch["submission_type"] is not None:
        s.submission_type = patch["submission_type"].strip()
    await db.flush()
    return {"id": s.id, "title": s.title, "submission_type": s.submission_type}


@router.delete("/club-submissions/{sub_id}")
async def delete_my_club_submission(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 동아리 산출물 삭제."""
    from app.models.club import ClubSubmission
    s = (await db.execute(
        select(ClubSubmission).where(
            ClubSubmission.id == sub_id,
            ClubSubmission.author_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 산출물만 삭제 가능합니다")
    await db.delete(s)
    await db.flush()
    return {"ok": True, "id": sub_id}


@router.get("/club-submissions")
async def my_club_submissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 동아리에 제출한 산출물."""
    from app.models.club import Club, ClubSubmission
    rows = (await db.execute(
        select(ClubSubmission, Club)
        .join(Club, Club.id == ClubSubmission.club_id)
        .where(ClubSubmission.author_id == user.id)
        .order_by(desc(ClubSubmission.created_at))
    )).all()
    return {
        "items": [
            {
                "id": s.id,
                "club_id": s.club_id,
                "club_name": c.name,
                "title": s.title,
                "submission_type": s.submission_type,
                "file_path": s.file_path,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, c in rows
        ]
    }


# ── 통합 활동 timeline (포트폴리오 페이지 단일 timeline) ──

@router.get("/all-activities")
async def my_all_activities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 모든 활동 통합 (포트폴리오 단일 timeline).

    종류: 자유 업로드 산출물 / 과제 제출물 / 동아리 산출물.
    최신순.
    """
    from app.models.assignment import Assignment, AssignmentSubmission
    from app.models.club import Club, ClubSubmission

    artifacts = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.student_id == user.id)
        .order_by(desc(StudentArtifact.created_at))
    )).scalars().all()

    submissions = (await db.execute(
        select(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .where(AssignmentSubmission.user_id == user.id)
        .order_by(desc(AssignmentSubmission.submitted_at))
    )).all()

    club_subs = (await db.execute(
        select(ClubSubmission, Club)
        .join(Club, Club.id == ClubSubmission.club_id)
        .where(ClubSubmission.author_id == user.id)
        .order_by(desc(ClubSubmission.created_at))
    )).all()

    timeline = []
    for a in artifacts:
        timeline.append({
            "type": "artifact",
            "id": a.id,
            "title": a.title,
            "category": a.category,
            "description": a.description,
            "file_url": a.file_url,
            "file_name": a.file_name,
            "is_public": a.is_public,
            "date": a.created_at.isoformat() if a.created_at else None,
        })
    for s, asn in submissions:
        timeline.append({
            "type": "assignment_submission",
            "id": s.id,
            "title": asn.title,
            "subject": asn.subject,
            "filename": s.filename,
            "status": s.status.value if hasattr(s.status, "value") else s.status,
            "review_comment": s.review_comment,
            "show_in_portfolio": bool(s.show_in_portfolio),
            "date": s.submitted_at.isoformat() if s.submitted_at else None,
        })
    for cs, club in club_subs:
        timeline.append({
            "type": "club_submission",
            "id": cs.id,
            "title": cs.title,
            "club_name": club.name,
            "submission_type": cs.submission_type,
            "file_path": cs.file_path,
            "date": cs.created_at.isoformat() if cs.created_at else None,
        })

    timeline.sort(key=lambda x: x.get("date") or "", reverse=True)
    return {"items": timeline}
