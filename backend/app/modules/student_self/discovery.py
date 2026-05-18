"""학생 본인용 정보 탐색 endpoints — 과거 연구 열람 + 대시보드 통계.

router 객체는 router.py에서 공유. router.py 끝의 'from . import discovery'로 등록.
"""

from fastapi import Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.research import ResearchProject
from app.models.student_self import StudentArtifact
from app.models.user import User

from app.modules.student_self.router import router


@router.get("/research/browse")
async def browse_alumni_research(
    keyword: str | None = None,
    year: int | None = None,
    research_type: str | None = None,
    limit: int = Query(50, le=200),
    user: User = Depends(require_permission("student.research.browse")),
    db: AsyncSession = Depends(get_db),
):
    """과거 학생들의 완료된 연구 목록.
    학생이 진로 탐색·연구 주제 잡을 때 참고용.
    민감 정보(개인 평가, 미공개 자료)는 제외하고 요약만 노출.
    """
    q = select(ResearchProject).where(ResearchProject.status.in_(["completed", "published"]))
    if keyword:
        q = q.where(ResearchProject.title.ilike(f"%{keyword}%"))
    if year:
        q = q.where(ResearchProject.year == year)
    if research_type:
        q = q.where(ResearchProject.research_type == research_type)

    q = q.order_by(desc(ResearchProject.year), desc(ResearchProject.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    # advisor 이름 한 번에 조회
    advisor_ids = {r.advisor_id for r in rows if r.advisor_id}
    advisor_map: dict[int, str] = {}
    if advisor_ids:
        advs = (await db.execute(select(User).where(User.id.in_(advisor_ids)))).scalars().all()
        advisor_map = {u.id: u.name for u in advs}

    return {"items": [
        {
            "id": r.id, "title": r.title,
            "research_type": r.research_type,
            "description": (r.description or "")[:500],
            "year": r.year, "semester": r.semester,
            "status": r.status,
            "advisor_name": advisor_map.get(r.advisor_id) if r.advisor_id else None,
            "members": r.members or [],  # 보통 학생 이름 리스트
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]}


@router.get("/dashboard-stats")
async def my_dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 대시보드용 요약 통계.

    교사/관리자가 호출하면 0 또는 빈 값 (자기 학생 데이터 기준).
    학생만 의미있는 값 반환.
    """
    from sqlalchemy import func as sa_func
    from app.models.portfolio import StudentAward, StudentThesis
    from app.models.club import ClubSubmission
    from app.models.assignment import AssignmentSubmission

    awards_count = (await db.execute(
        select(sa_func.count(StudentAward.id)).where(StudentAward.student_id == user.id)
    )).scalar() or 0
    theses_count = (await db.execute(
        select(sa_func.count(StudentThesis.id)).where(StudentThesis.student_id == user.id)
    )).scalars().first() or 0
    club_activities = (await db.execute(
        select(sa_func.count(ClubSubmission.id)).where(ClubSubmission.author_id == user.id)
    )).scalar() or 0
    assignments_submitted = (await db.execute(
        select(sa_func.count(AssignmentSubmission.id)).where(AssignmentSubmission.user_id == user.id)
    )).scalar() or 0
    artifacts_count = (await db.execute(
        select(sa_func.count(StudentArtifact.id)).where(StudentArtifact.student_id == user.id)
    )).scalar() or 0

    return {
        "awards_count": int(awards_count),
        "theses_count": int(theses_count),
        "club_activities": int(club_activities),
        "assignments_submitted": int(assignments_submitted),
        "artifacts_count": int(artifacts_count),
    }
