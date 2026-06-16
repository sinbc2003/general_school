"""강좌 성적표(gradebook) — 과제 점수 + 코스웨어 문제세트 점수를 학생×항목 매트릭스로 집계.

읽기 전용. 데이터는 이미 존재 (CoursePostSubmission.score, StudentProblemAttempt) —
강좌 단위로 묶는 경로만 없어 상세 페이지 '성적' 탭이 placeholder였다.

권한: classroom.course.view + _assert_course_access (신규 권한 없음).
  - admin / 교사(owner·co_teacher): 전원
  - 학생: 본인 행만
"""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CoursePost, CoursePostSubmission, CourseStudent
from app.models.courseware import CourseProblemSet, StudentProblemAttempt
from app.models.user import User
from app.modules.classroom.router import _assert_course_access, router


def _attempt_score(a: StudentProblemAttempt) -> float | None:
    """문제 1개에 대한 채점 점수(0~1). 미채점(essay 대기 등)이면 None."""
    if a.manual_score is not None:
        return a.manual_score
    if a.auto_score is not None:
        return a.auto_score
    if a.is_correct is True:
        return 1.0
    if a.is_correct is False:
        return 0.0
    return None


@router.get("/courses/{cid}/grades")
async def course_gradebook(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """강좌 성적표 — 컬럼(과제·문제세트) × 행(학생) 매트릭스."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    role = await _assert_course_access(db, user, course)  # admin/teacher/student or 403

    # ── 로스터 (학생은 본인만) ──
    roster_q = (
        select(User)
        .join(CourseStudent, CourseStudent.student_id == User.id)
        .where(CourseStudent.course_id == cid, CourseStudent.status == "active")
        .order_by(User.grade, User.class_number, User.student_number, User.name)
    )
    if role == "student":
        roster_q = roster_q.where(User.id == user.id)
    students = (await db.execute(roster_q)).scalars().all()
    student_ids = [s.id for s in students]

    # ── 컬럼: 과제(assignment_ref) + 문제세트(published/closed) ──
    assignment_posts = (await db.execute(
        select(CoursePost)
        .where(CoursePost.course_id == cid, CoursePost.post_type == "assignment_ref")
        .order_by(CoursePost.created_at)
    )).scalars().all()
    problem_sets = (await db.execute(
        select(CourseProblemSet)
        .where(
            CourseProblemSet.course_id == cid,
            CourseProblemSet.deleted_at.is_(None),
            CourseProblemSet.status.in_(("published", "closed")),
        )
        .order_by(CourseProblemSet.created_at)
    )).scalars().all()

    columns: list[dict] = []
    for p in assignment_posts:
        columns.append({
            "key": f"assignment:{p.id}", "kind": "assignment",
            "id": p.id, "title": p.title, "max_score": p.max_score,
        })
    for ps in problem_sets:
        columns.append({
            "key": f"problemset:{ps.id}", "kind": "problemset",
            "id": ps.id, "title": ps.title, "total": len(ps.problem_ids or []),
        })

    # ── 셀 데이터 batch ──
    sub_map: dict[tuple[int, int], CoursePostSubmission] = {}
    best_by_student_set: dict[tuple[int, int], dict[int, float]] = {}
    if student_ids:
        post_ids = [p.id for p in assignment_posts]
        if post_ids:
            subs = (await db.execute(
                select(CoursePostSubmission).where(
                    CoursePostSubmission.post_id.in_(post_ids),
                    CoursePostSubmission.student_id.in_(student_ids),
                )
            )).scalars().all()
            for s in subs:
                sub_map[(s.post_id, s.student_id)] = s
        set_ids = [ps.id for ps in problem_sets]
        if set_ids:
            attempts = (await db.execute(
                select(StudentProblemAttempt).where(
                    StudentProblemAttempt.problem_set_id.in_(set_ids),
                    StudentProblemAttempt.student_id.in_(student_ids),
                )
            )).scalars().all()
            for a in attempts:
                sc = _attempt_score(a)
                if sc is None:
                    continue
                best = best_by_student_set.setdefault((a.student_id, a.problem_set_id), {})
                prev = best.get(a.problem_id)
                if prev is None or sc > prev:
                    best[a.problem_id] = sc  # 문제별 최고 점수

    # ── 행 구성 ──
    rows: list[dict] = []
    for s in students:
        cells: dict[str, dict] = {}
        for p in assignment_posts:
            sub = sub_map.get((p.id, s.id))
            if sub:
                cells[f"assignment:{p.id}"] = {"score": sub.score, "status": sub.status}
        for ps in problem_sets:
            best = best_by_student_set.get((s.id, ps.id))
            if best:
                total = len(ps.problem_ids or []) or len(best)
                earned = sum(best.values())
                cells[f"problemset:{ps.id}"] = {
                    "answered": len(best),
                    "total": total,
                    "earned": round(earned, 2),
                    "percent": round(earned / total * 100) if total else None,
                }
        rows.append({
            "student_id": s.id,
            "name": s.name,
            "grade": s.grade,
            "class_number": s.class_number,
            "student_number": s.student_number,
            "cells": cells,
        })

    return {"columns": columns, "rows": rows, "role": role}
