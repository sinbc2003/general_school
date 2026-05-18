"""교사용 학생 산출물/진로 조회 + 공개 산출물 갤러리.

학생 본인 endpoints는 `student_self/router.py`. 본 모듈은 교사가 지도 목적으로 학생 데이터를 조회.

router 객체는 router.py에서 공유. router.py 끝의 'from . import teacher_views'로 등록.
"""

from fastapi import Depends
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.student_self import StudentArtifact, StudentCareerPlan
from app.models.user import User
from app.modules.portfolio.router import router


# ── 교사용: 특정 학생의 산출물 / 진로 계획 조회 ──
# (학생 본인은 /api/me/artifacts, /api/me/career-plans 사용)

@router.get("/{sid}/artifacts")
async def list_student_artifacts(
    sid: int,
    category: str | None = None,
    user: User = Depends(require_permission("portfolio.artifact.view")),
    db: AsyncSession = Depends(get_db),
):
    """교사가 특정 학생의 산출물 조회 (지도 목적)"""
    await assert_can_view_student(db, user, sid)
    q = select(StudentArtifact).where(StudentArtifact.student_id == sid)
    if category:
        q = q.where(StudentArtifact.category == category)
    rows = (await db.execute(q.order_by(desc(StudentArtifact.created_at)))).scalars().all()
    return {"items": [
        {
            "id": a.id, "title": a.title, "description": a.description,
            "category": a.category,
            "file_url": a.file_url, "file_name": a.file_name,
            "file_size": a.file_size, "mime_type": a.mime_type,
            "external_link": a.external_link,
            "tags": a.tags or [], "is_public": a.is_public,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        } for a in rows
    ]}


@router.get("/{sid}/career-plans")
async def list_student_career_plans(
    sid: int,
    user: User = Depends(require_permission("portfolio.career.view")),
    db: AsyncSession = Depends(get_db),
):
    """교사가 특정 학생의 진로/진학 설계 조회 (지도 목적)"""
    await assert_can_view_student(db, user, sid)
    rows = (await db.execute(
        select(StudentCareerPlan).where(StudentCareerPlan.student_id == sid)
        .order_by(desc(StudentCareerPlan.year), desc(StudentCareerPlan.updated_at))
    )).scalars().all()
    return {"items": [
        {
            "id": p.id, "year": p.year,
            "desired_field": p.desired_field, "career_goal": p.career_goal,
            "target_universities": p.target_universities or [],
            "target_majors": p.target_majors or [],
            "academic_plan": p.academic_plan, "activity_plan": p.activity_plan,
            "semester_goals": p.semester_goals or [],
            "motivation": p.motivation, "notes": p.notes,
            "is_active": p.is_active,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        } for p in rows
    ]}


# ── 교사용: 모든 학생의 공개 산출물 모음 = 학생 산출물 갤러리 (전체 둘러보기) ──

@router.get("/_io/artifacts/public")
async def list_all_public_artifacts(
    category: str | None = None,
    keyword: str | None = None,
    limit: int = 100,
    user: User = Depends(require_permission("portfolio.artifact.view")),
    db: AsyncSession = Depends(get_db),
):
    """교사가 모든 학생의 공개 산출물을 한 번에 조회.
    학생 이름·학년·반 함께 표시.
    """
    q = (select(StudentArtifact, User.name, User.grade, User.class_number, User.student_number)
         .join(User, User.id == StudentArtifact.student_id)
         .where(StudentArtifact.is_public == True))
    if category:
        q = q.where(StudentArtifact.category == category)
    if keyword:
        q = q.where(StudentArtifact.title.ilike(f"%{keyword}%"))
    q = q.order_by(desc(StudentArtifact.created_at)).limit(limit)
    rows = (await db.execute(q)).all()
    return {"items": [
        {
            "id": a.id, "title": a.title, "description": a.description,
            "category": a.category,
            "file_url": a.file_url, "external_link": a.external_link,
            "tags": a.tags or [], "is_public": a.is_public,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "student_id": a.student_id,
            "student_name": name,
            "student_class": f"{grade or '-'}-{class_number or '-'}-{student_number or '-'}",
        } for a, name, grade, class_number, student_number in rows
    ]}
