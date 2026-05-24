"""문제은행 코스웨어 — dashboard endpoint (학생·교사 통계).

학생: /me/dashboard — 4박스 통계 + 주 단위 streak + 오늘의 학습 추천
교사: /teacher/dashboard — 4박스 통계 (출제·게시·평균·needs_review)
+ my-problem-sets에 set별 stats 추가 (별도 endpoint /my-problem-sets-detailed)

router 객체는 router.py에서 공유. router.py 끝의 'from . import dashboard'로 등록.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    Course, CourseProblemSet, CourseStudent, CourseTeacher, Problem,
    StudentProblemAttempt, User,
)
from app.modules.courseware.router import router


def _week_start_utc() -> datetime:
    """이번 주 월요일 00:00 UTC (한국 시간대 기준 단순화)."""
    now = datetime.now(timezone.utc)
    monday = now - timedelta(days=now.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


# ─────────────────────────────────────────────────────────────────────────────
# 학생 dashboard
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/me/dashboard")
async def student_dashboard(
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 통계 + 오늘의 학습 추천.

    응답:
      total_attempts: 본인 attempt 수 (중복 포함)
      distinct_problems: 푼 문제 수 (distinct)
      auto_accuracy: 자동채점 가능 attempt 중 정답률 (0~1)
      avg_score: best per ps 평균 (0~1)
      streak_this_week: 이번 주 풀이한 날 수 (0~7)
      today_card: 추천 ProblemSet (마감 24h + 미시도 우선) — null 가능
    """
    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.student_id == user.id,
        )
    )).scalars().all()

    total_attempts = len(rows)
    distinct_problems = len({r.problem_id for r in rows})

    auto_total = sum(1 for r in rows if r.is_correct is not None)
    auto_correct = sum(1 for r in rows if r.is_correct is True)
    auto_accuracy = round(auto_correct / auto_total, 3) if auto_total > 0 else 0.0

    # best score per problem_set
    best_per_ps: dict[int, float] = {}
    for r in rows:
        score = 0.0
        if r.is_correct is True:
            score = r.auto_score or 1.0
        elif r.is_correct is False:
            score = r.auto_score or 0.0
        elif r.manual_score is not None:
            score = r.manual_score
        prev = best_per_ps.get(r.problem_set_id, 0.0)
        if score > prev:
            best_per_ps[r.problem_set_id] = score
    avg_score = (
        round(sum(best_per_ps.values()) / len(best_per_ps), 3)
        if best_per_ps else 0.0
    )

    # 이번 주 풀이일 수
    week_start = _week_start_utc()
    week_dates = {
        r.submitted_at.date()
        for r in rows
        if r.submitted_at and r.submitted_at >= week_start
    }
    streak_this_week = len(week_dates)

    # 오늘의 학습 추천 — 마감 24h 이내 + status=published + 미시도 우선,
    # 없으면 그냥 published 중 최근 1개
    course_ids = (await db.execute(
        select(CourseStudent.course_id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()

    today_card = None
    if course_ids:
        now = datetime.now(timezone.utc)
        soon = now + timedelta(hours=24)
        # 마감 24h 이내 published
        urgent = (await db.execute(
            select(CourseProblemSet).where(
                CourseProblemSet.course_id.in_(course_ids),
                CourseProblemSet.deleted_at.is_(None),
                CourseProblemSet.status == "published",
                CourseProblemSet.due_date.isnot(None),
                CourseProblemSet.due_date >= now,
                CourseProblemSet.due_date <= soon,
            ).order_by(CourseProblemSet.due_date.asc()).limit(5)
        )).scalars().all()
        attempted_ps_ids = {r.problem_set_id for r in rows}

        # 미시도 urgent 우선
        for ps in urgent:
            if ps.id not in attempted_ps_ids:
                today_card = _pick_today_card(ps, "마감 임박 · 미응시")
                break
        # 그래도 없으면 urgent 중 가장 빠른 마감
        if not today_card and urgent:
            today_card = _pick_today_card(urgent[0], "마감 임박")
        # urgent도 없으면 published 중 미시도 가장 최근 생성된 거
        if not today_card:
            recent = (await db.execute(
                select(CourseProblemSet).where(
                    CourseProblemSet.course_id.in_(course_ids),
                    CourseProblemSet.deleted_at.is_(None),
                    CourseProblemSet.status == "published",
                ).order_by(CourseProblemSet.created_at.desc()).limit(10)
            )).scalars().all()
            for ps in recent:
                if ps.id not in attempted_ps_ids:
                    today_card = _pick_today_card(ps, "새 문제")
                    break

    return {
        "total_attempts": total_attempts,
        "distinct_problems": distinct_problems,
        "auto_accuracy": auto_accuracy,
        "avg_score": avg_score,
        "streak_this_week": streak_this_week,
        "today_card": today_card,
    }


def _pick_today_card(ps: CourseProblemSet, reason: str) -> dict:
    return {
        "problem_set_id": ps.id,
        "course_id": ps.course_id,
        "title": ps.title,
        "description": ps.description,
        "problem_count": len(ps.problem_ids or []),
        "due_date": ps.due_date.isoformat() if ps.due_date else None,
        "max_attempts": ps.max_attempts,
        "reason": reason,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 교사 dashboard
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/teacher/dashboard")
async def teacher_dashboard(
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """교사 통계.

    응답:
      total_sets: 본인 강좌의 전체 ProblemSet 수 (deleted 제외)
      published_sets: status=published 수
      total_attempts: 학생 attempt 누적
      auto_accuracy: 자동채점 정답률 (0~1)
      needs_review_count: 신뢰도 낮은 attempt (교사 검토 우선)
      failed_count: LLM 채점 실패 attempt
    """
    if user.role == "student":
        raise HTTPException(403, "교사·관리자 전용")

    is_admin = user.role in ("super_admin", "designated_admin")

    # 본인 강좌
    if is_admin:
        cids = (await db.execute(
            select(Course.id).where(Course.is_active == True)  # noqa: E712
        )).scalars().all()
    else:
        owner = (await db.execute(
            select(Course.id).where(Course.teacher_id == user.id)
        )).scalars().all()
        co = (await db.execute(
            select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
        )).scalars().all()
        cids = list(set(list(owner) + list(co)))

    if not cids:
        return {
            "total_sets": 0, "published_sets": 0,
            "total_attempts": 0, "auto_accuracy": 0.0,
            "needs_review_count": 0, "failed_count": 0,
        }

    sets = (await db.execute(
        select(CourseProblemSet).where(
            CourseProblemSet.course_id.in_(cids),
            CourseProblemSet.deleted_at.is_(None),
        )
    )).scalars().all()
    total_sets = len(sets)
    published_sets = sum(1 for s in sets if s.status == "published")

    set_ids = [s.id for s in sets]
    if not set_ids:
        return {
            "total_sets": total_sets, "published_sets": published_sets,
            "total_attempts": 0, "auto_accuracy": 0.0,
            "needs_review_count": 0, "failed_count": 0,
        }

    attempts = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id.in_(set_ids),
        )
    )).scalars().all()

    total_attempts = len(attempts)
    auto_total = sum(1 for a in attempts if a.is_correct is not None)
    auto_correct = sum(1 for a in attempts if a.is_correct is True)
    auto_accuracy = round(auto_correct / auto_total, 3) if auto_total > 0 else 0.0
    needs_review_count = sum(1 for a in attempts if a.grading_status == "needs_review")
    failed_count = sum(1 for a in attempts if a.grading_status == "failed")

    return {
        "total_sets": total_sets,
        "published_sets": published_sets,
        "total_attempts": total_attempts,
        "auto_accuracy": auto_accuracy,
        "needs_review_count": needs_review_count,
        "failed_count": failed_count,
    }
