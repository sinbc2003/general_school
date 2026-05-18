"""포트폴리오 통계 + 타임라인.

router 객체는 router.py에서 공유. router.py 끝의 'from . import analytics'로 등록.
"""

from collections import defaultdict

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.portfolio import (
    StudentAward, StudentCounseling, StudentGrade, StudentMockExam, StudentThesis,
)
from app.models.user import User
from app.modules.portfolio.router import router


@router.get("/{sid}/stats")
async def portfolio_stats(
    sid: int,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 다년치 누적 통계 — 학년/학기별 평균, 수상 개수, 상담 개수, 모의고사 등급 추이"""
    await assert_can_view_student(db, user, sid)
    student = (await db.execute(select(User).where(User.id == sid))).scalar_one_or_none()
    if not student:
        raise HTTPException(404)

    grades = (await db.execute(select(StudentGrade).where(StudentGrade.student_id == sid))).scalars().all()
    awards = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
    counselings = (await db.execute(select(StudentCounseling).where(StudentCounseling.student_id == sid))).scalars().all()
    mocks = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()

    # 학년/학기별 평균 점수 (모든 과목 단순 평균)
    by_period: dict = defaultdict(lambda: {"sum": 0.0, "count": 0, "subjects": defaultdict(list)})
    for g in grades:
        key = f"{g.year}-{g.semester}"
        by_period[key]["sum"] += g.score
        by_period[key]["count"] += 1
        by_period[key]["subjects"][g.subject].append(g.score)
    grade_trend = []
    for key in sorted(by_period.keys()):
        d = by_period[key]
        grade_trend.append({
            "period": key,
            "avg": round(d["sum"] / max(d["count"], 1), 2),
            "subject_count": len(d["subjects"]),
            "subject_averages": {s: round(sum(v) / len(v), 2) for s, v in d["subjects"].items()},
        })

    # 수상 카테고리별
    award_by_cat: dict = defaultdict(int)
    award_by_year: dict = defaultdict(int)
    for a in awards:
        award_by_cat[a.category] += 1
        if a.award_date:
            award_by_year[a.award_date.year] += 1

    # 상담 유형별
    counsel_by_type: dict = defaultdict(int)
    for c in counselings:
        counsel_by_type[c.counseling_type] += 1

    # 모의고사 시점별 등급 (최신순)
    mock_trend = sorted(
        [{"date": m.exam_date.isoformat() if m.exam_date else "", "subject": m.subject,
          "grade_level": m.grade_level, "percentile": m.percentile}
         for m in mocks if m.exam_date],
        key=lambda x: x["date"]
    )

    return {
        "student_id": sid,
        "student_name": student.name,
        "totals": {
            "grades": len(grades), "awards": len(awards),
            "counselings": len(counselings), "mock_exams": len(mocks),
        },
        "grade_trend": grade_trend,
        "award_by_category": dict(award_by_cat),
        "award_by_year": dict(award_by_year),
        "counseling_by_type": dict(counsel_by_type),
        "mock_trend": mock_trend,
    }


@router.get("/{sid}/timeline")
async def portfolio_timeline(
    sid: int, limit: int = 100,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 활동 타임라인 — 모든 활동을 시간순으로 통합"""
    await assert_can_view_student(db, user, sid)
    events: list = []

    awards = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
    for a in awards:
        if a.award_date:
            events.append({"date": a.award_date.isoformat(), "type": "award",
                          "title": a.title, "summary": f"{a.category} {a.award_level}"})

    mocks = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()
    for m in mocks:
        if m.exam_date:
            events.append({"date": m.exam_date.isoformat(), "type": "mockexam",
                          "title": m.exam_name, "summary": f"{m.subject}: {m.raw_score}점 (등급 {m.grade_level or '-'})"})

    counselings = (await db.execute(select(StudentCounseling).where(StudentCounseling.student_id == sid))).scalars().all()
    for c in counselings:
        events.append({"date": c.counseling_date.isoformat(), "type": "counseling",
                      "title": c.title, "summary": c.counseling_type})

    theses = (await db.execute(select(StudentThesis).where(StudentThesis.student_id == sid))).scalars().all()
    for t in theses:
        if t.created_at:
            events.append({"date": t.created_at.date().isoformat(), "type": "thesis",
                          "title": t.title, "summary": f"{t.thesis_type} ({t.status})"})

    events.sort(key=lambda x: x["date"], reverse=True)
    return {"events": events[:limit]}
