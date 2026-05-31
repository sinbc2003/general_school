"""학생 생기부 보조자료 PDF 출력 endpoint.

router 객체는 router.py에서 공유. router.py 끝의 'from . import pdf_report'로 등록.
"""

import asyncio

from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.http import content_disposition
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.portfolio import (
    StudentAward, StudentCounseling, StudentGrade, StudentMockExam,
    StudentRecord, StudentThesis,
)
from app.models.student_self import StudentArtifact
from app.models.user import User
from app.modules.portfolio.router import router
from app.services.report_pdf import generate_student_pdf


@router.get("/{sid}/report.pdf")
async def student_report_pdf(
    sid: int, request: Request,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 종합 포트폴리오 PDF (생기부 양식 모방)"""
    await assert_can_view_student(db, user, sid)
    student = (await db.execute(select(User).where(User.id == sid))).scalar_one_or_none()
    if not student or student.role != "student":
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    grades = (await db.execute(select(StudentGrade).where(StudentGrade.student_id == sid))).scalars().all()
    awards = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
    mocks = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()
    theses = (await db.execute(select(StudentThesis).where(StudentThesis.student_id == sid))).scalars().all()
    counselings = (await db.execute(select(StudentCounseling).where(StudentCounseling.student_id == sid))).scalars().all()
    records = (await db.execute(select(StudentRecord).where(StudentRecord.student_id == sid))).scalars().all()

    # 학생 본인이 등록한 자유 산출물 (is_public 필터링은 PDF generator 내부에서 수행)
    artifacts = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.student_id == sid)
    )).scalars().all()

    # 과제 제출물 (show_in_portfolio=True인 것만 사용) + 동아리 산출물
    from app.models.assignment import Assignment, AssignmentSubmission
    from app.models.club import Club, ClubSubmission
    assignment_subs = (await db.execute(
        select(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .where(AssignmentSubmission.user_id == sid)
    )).all()
    club_subs = (await db.execute(
        select(ClubSubmission, Club)
        .join(Club, Club.id == ClubSubmission.club_id)
        .where(ClubSubmission.author_id == sid)
    )).all()

    # ReportLab은 CPU-bound (200~500ms). event loop을 막지 않게 to_thread로 위임.
    # gunicorn 4 worker 환경에서 동시 PDF 요청이 와도 다른 워커가 다른 요청을 받음.
    pdf_bytes = await asyncio.to_thread(
        generate_student_pdf,
        student={
            "name": student.name, "email": student.email, "grade": student.grade,
            "class_number": student.class_number, "student_number": student.student_number,
            "status": student.status,
            "created_at": student.created_at.isoformat() if student.created_at else "",
        },
        grades=list(grades), awards=list(awards), mock_exams=list(mocks),
        theses=list(theses), counselings=list(counselings), records=list(records),
        school_name=settings.SCHOOL_NAME,
        artifacts=list(artifacts),
        assignment_submissions=list(assignment_subs),
        club_submissions=list(club_subs),
    )

    await log_action(db, user, "portfolio.report.export", f"student:{sid}", request=request, is_sensitive=True)

    return Response(
        content=pdf_bytes, media_type="application/pdf",
        headers={"Content-Disposition": content_disposition(f"{student.name}_portfolio.pdf", inline=True)},
    )
