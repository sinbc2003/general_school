"""학생 본인 수강과목 마법사.

엔드포인트:
  GET    /api/me/enrollment/status                   — 본인 학기 enrollment + 마법사 완료 여부
  GET    /api/me/enrollment/available-courses        — 본인이 등록 가능한 강좌 후보
                                                        (학급 단위 자동 강좌 + 선택과목 후보)
  POST   /api/me/enrollment/subjects                 — 선택과목 등록 (course_ids list)
  DELETE /api/me/enrollment/subjects/{course_id}     — 수강 취소
  POST   /api/me/enrollment/complete                 — 마법사 완료 표시 (onboarded=True)

원칙:
  - 학생 본인만. role != student면 403.
  - 학급 단위 강좌(class_homeroom + class_name="G-C")는 학생이 등록할 필요 없음
    (course_seed 또는 auto_generate가 자동 등록). 학생 마법사는 선택과목 위주.
  - SemesterEnrollment.onboarded 컬럼을 학생 마법사 완료 플래그로 재활용.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.models import (
    Course, CourseStudent, Semester, SemesterEnrollment, User,
)
from app.modules.student_self.router import router


# ─────────────────────────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────────────────────────


def _require_student(user: User) -> None:
    if user.role != "student":
        raise HTTPException(403, "학생만 사용할 수 있는 기능입니다")


def _course_brief(c: Course) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "subject": c.subject,
        "class_name": c.class_name,
        "course_type": c.course_type,
        "grade_level": c.grade_level,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────


class EnrollSubjectsReq(BaseModel):
    course_ids: list[int] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Status — 마법사 진입 여부 판단
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/enrollment/status")
async def my_enrollment_status(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """현재 학기 본인 enrollment + 마법사 완료 여부.

    onboarded=False면 frontend가 /s/enrollment-wizard로 redirect.
    """
    _require_student(user)
    sid = await get_active_semester_id_or_404(db)
    sem = await db.get(Semester, sid)
    enr = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        ).limit(1)
    )).scalar_one_or_none()
    enrolled_count = (await db.execute(
        select(CourseStudent).join(
            Course, Course.id == CourseStudent.course_id,
        ).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
            Course.semester_id == sid,
        )
    )).all()
    return {
        "semester": {
            "id": sem.id, "year": sem.year, "semester": sem.semester, "name": sem.name,
        } if sem else None,
        "onboarded": bool(enr.onboarded) if enr else False,
        "has_enrollment_record": enr is not None,
        "enrolled_courses_count": len(enrolled_count),
        "grade": user.grade,
        "class_number": user.class_number,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Available courses — 등록 가능한 강좌 후보
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/enrollment/available-courses")
async def my_available_courses(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 등록 가능한 강좌 후보.

    - already_enrolled: 이미 수강 중 (학급 단위 + 본인이 등록한 선택과목)
    - candidates: 선택과목 후보 (class_name=None 인 강좌 — 모든 학생 공통)
    """
    _require_student(user)
    sid = await get_active_semester_id_or_404(db)

    # 이미 수강 중
    enrolled_rows = (await db.execute(
        select(Course).join(
            CourseStudent, CourseStudent.course_id == Course.id,
        ).where(
            Course.semester_id == sid,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
            Course.is_active == True,  # noqa: E712
        ).order_by(Course.subject)
    )).scalars().all()
    enrolled_ids = {c.id for c in enrolled_rows}

    # 선택과목 후보 (class_name=None + 본인 학년 grade_level 일치 또는 grade_level=None)
    cand_q = select(Course).where(
        Course.semester_id == sid,
        Course.class_name.is_(None),
        Course.is_active == True,  # noqa: E712
        Course.course_type == "subject",
    )
    if user.grade is not None:
        cand_q = cand_q.where(
            (Course.grade_level == user.grade) | (Course.grade_level.is_(None))
        )
    cand_q = cand_q.order_by(Course.subject)
    candidates = (await db.execute(cand_q)).scalars().all()
    candidates = [c for c in candidates if c.id not in enrolled_ids]

    return {
        "already_enrolled": [_course_brief(c) for c in enrolled_rows],
        "candidates": [_course_brief(c) for c in candidates],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Enroll subjects — 선택과목 등록
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/enrollment/subjects")
async def enroll_subjects(
    body: EnrollSubjectsReq,
    request: Request,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """학생이 선택과목 등록. course_ids는 선택과목(class_name=None) 강좌만 허용."""
    _require_student(user)
    sid = await get_active_semester_id_or_404(db)

    if not body.course_ids:
        return {"added": 0, "skipped": 0, "errors": []}

    courses = (await db.execute(
        select(Course).where(
            Course.id.in_(body.course_ids),
            Course.semester_id == sid,
            Course.is_active == True,  # noqa: E712
        )
    )).scalars().all()
    by_id = {c.id: c for c in courses}

    added = 0
    skipped = 0
    errors: list[str] = []

    for cid in body.course_ids:
        c = by_id.get(cid)
        if not c:
            errors.append(f"course:{cid} 없음 또는 다른 학기")
            continue
        # 선택과목만 학생 본인 등록 허용 (학급 단위는 자동 등록)
        if c.class_name is not None and c.course_type == "subject":
            errors.append(f"course:{cid} 학급 단위 강좌는 자동 등록")
            continue
        if c.course_type != "subject":
            errors.append(f"course:{cid} 교과(subject) 강좌만 직접 등록 가능")
            continue
        dup = (await db.execute(
            select(CourseStudent).where(
                CourseStudent.course_id == cid,
                CourseStudent.student_id == user.id,
            )
        )).scalar_one_or_none()
        if dup:
            if dup.status != "active":
                dup.status = "active"
                added += 1
            else:
                skipped += 1
            continue
        db.add(CourseStudent(course_id=cid, student_id=user.id, status="active"))
        added += 1

    await db.flush()

    # 폴더 자동 동기화 (학생 수강 강좌 폴더 추가).
    if added:
        try:
            from app.services.folder_seed import on_course_student_enrolled
            for cid in body.course_ids:
                if cid in by_id:
                    await on_course_student_enrolled(db, course_id=cid, student_id=user.id)
        except Exception:
            pass

    await log_action(
        db, user, "enrollment.subject.add",
        target=f"student:{user.id}",
        detail=f"course_ids={body.course_ids} added={added}",
        request=request,
    )
    return {"added": added, "skipped": skipped, "errors": errors}


# ─────────────────────────────────────────────────────────────────────────────
# Drop subject — 수강 취소 (선택과목만)
# ─────────────────────────────────────────────────────────────────────────────


@router.delete("/enrollment/subjects/{course_id}")
async def drop_subject(
    course_id: int,
    request: Request,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(404, "강좌가 없습니다")
    # 학급 단위 강좌는 학생 본인이 끊을 수 없음 (admin이 처리)
    if course.class_name is not None and course.course_type == "subject":
        raise HTTPException(400, "학급 단위 강좌는 본인이 취소할 수 없습니다")

    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course_id,
            CourseStudent.student_id == user.id,
        )
    )).scalar_one_or_none()
    if not cs:
        raise HTTPException(404, "수강 기록이 없습니다")

    cs.status = "dropped"
    await db.flush()
    await log_action(
        db, user, "enrollment.subject.drop",
        target=f"student:{user.id} course:{course_id}",
        request=request,
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# Complete wizard — 마법사 완료 표시
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/enrollment/complete")
async def complete_enrollment_wizard(
    request: Request,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """마법사 완료. SemesterEnrollment.onboarded=True (없으면 새로 생성)."""
    _require_student(user)
    sid = await get_active_semester_id_or_404(db)
    enr = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == sid,
            SemesterEnrollment.user_id == user.id,
        ).limit(1)
    )).scalar_one_or_none()
    if not enr:
        enr = SemesterEnrollment(
            semester_id=sid,
            user_id=user.id,
            role="student",
            status="active",
            grade=user.grade,
            class_number=user.class_number,
            student_number=user.student_number,
            onboarded=True,
        )
        db.add(enr)
    else:
        enr.onboarded = True
    await db.flush()

    # 마법사 완료 직후 자동 폴더 한번 더 동기화 (선택과목 추가했을 가능성).
    try:
        from app.services.folder_seed import sync_user_folders
        await sync_user_folders(db, user)
    except Exception:
        pass

    await log_action(
        db, user, "enrollment.wizard.complete",
        target=f"student:{user.id} semester:{sid}",
        request=request,
    )
    return {"ok": True, "onboarded": True}
