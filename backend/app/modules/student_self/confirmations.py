"""학생 '이상없음' 확인 — 생기부·수행평가·성적 통합 (내 확인 페이지).

엔드포인트 (/api/me prefix — student_self router):
  GET  /api/me/confirmations          본인 확인 상태 전체 (kind:ref_key → 상태)
  POST /api/me/confirmations          확인/수정요청 upsert (대상 소유 검증)
  GET  /api/me/returned-submissions   반환된 클래스룸 과제 제출물 (수행평가 점수·피드백)
  GET  /api/me/grades-summary         학기별 지필 성적 묶음

검증 규칙 (kind별 본인 소유 + 확인 가능 상태):
  - record     : RecordProjectStudent(project_id=ref, student_id=me, is_published=True)
  - submission : CoursePostSubmission(id=ref, student_id=me, status="returned")
  - grades     : 해당 (year, semester)에 본인 StudentGrade 1건 이상

수정요청 시 담당 교사에게 알림 (record→프로젝트 owner, submission→강좌 교사).
"""

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.classroom import Course, CoursePost, CoursePostSubmission
from app.models.confirmation import StudentConfirmation
from app.models.portfolio import StudentGrade
from app.models.student_record_project import RecordProject, RecordProjectStudent
from app.models.user import User
from app.modules.student_self.router import router


class ConfirmReq(BaseModel):
    kind: str = Field(..., pattern="^(record|submission|grades)$")
    ref_key: str = Field(..., min_length=1, max_length=50)
    status: str = Field(..., pattern="^(confirmed|revision_requested)$")
    comment: str | None = Field(None, max_length=2000)


def _conf_dict(c: StudentConfirmation) -> dict:
    return {
        "kind": c.kind,
        "ref_key": c.ref_key,
        "status": c.status,
        "comment": c.comment,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/confirmations")
async def my_confirmations(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(StudentConfirmation).where(StudentConfirmation.student_id == user.id)
    )).scalars().all()
    return {"items": {f"{c.kind}:{c.ref_key}": _conf_dict(c) for c in rows}}


async def _validate_target(
    db: AsyncSession, user: User, kind: str, ref_key: str,
) -> tuple[str, list[int]]:
    """대상 존재·소유 검증 → (표시 제목, 수정요청 시 알림 대상 교사 ids)."""
    if kind == "record":
        try:
            pid = int(ref_key)
        except ValueError:
            raise HTTPException(400, "잘못된 ref_key")
        row = (await db.execute(
            select(RecordProjectStudent).where(
                RecordProjectStudent.project_id == pid,
                RecordProjectStudent.student_id == user.id,
                RecordProjectStudent.is_published == True,  # noqa: E712
            )
        )).scalar_one_or_none()
        if not row:
            raise HTTPException(404, "공개된 본인 생기부가 아닙니다")
        p = await db.get(RecordProject, pid)
        return (p.name if p else f"생기부#{pid}", [p.owner_id] if p and p.owner_id else [])

    if kind == "submission":
        try:
            sid = int(ref_key)
        except ValueError:
            raise HTTPException(400, "잘못된 ref_key")
        sub = await db.get(CoursePostSubmission, sid)
        if not sub or sub.student_id != user.id:
            raise HTTPException(404, "본인 제출물이 아닙니다")
        if sub.status != "returned":
            raise HTTPException(409, "반환(채점)된 제출물만 확인할 수 있습니다")
        post = await db.get(CoursePost, sub.post_id)
        course = await db.get(Course, post.course_id) if post else None
        teachers = [uid for uid in {
            post.author_id if post else None,
            course.teacher_id if course else None,
        } if uid]
        return (post.title if post else f"제출물#{sid}", teachers)

    # grades — ref_key = "{year}-{semester}"
    try:
        year_s, sem_s = ref_key.split("-", 1)
        year, semester = int(year_s), int(sem_s)
    except ValueError:
        raise HTTPException(400, "잘못된 ref_key (예: 2026-1)")
    exists = (await db.execute(
        select(StudentGrade.id).where(
            StudentGrade.student_id == user.id,
            StudentGrade.year == year,
            StudentGrade.semester == semester,
        ).limit(1)
    )).scalar_one_or_none()
    if not exists:
        raise HTTPException(404, "해당 학기 성적이 없습니다")
    return (f"{year}학년도 {semester}학기 성적", [])


@router.post("/confirmations")
async def upsert_confirmation(
    body: ConfirmReq,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    title, teacher_ids = await _validate_target(db, user, body.kind, body.ref_key)

    row = (await db.execute(
        select(StudentConfirmation).where(
            StudentConfirmation.student_id == user.id,
            StudentConfirmation.kind == body.kind,
            StudentConfirmation.ref_key == body.ref_key,
        )
    )).scalar_one_or_none()
    if not row:
        row = StudentConfirmation(
            student_id=user.id, kind=body.kind, ref_key=body.ref_key,
            status=body.status,
        )
        db.add(row)
    row.status = body.status
    row.comment = (body.comment or "").strip() or None
    await db.flush()

    # 수정요청 → 담당 교사 알림 (best-effort)
    if body.status == "revision_requested" and teacher_ids:
        try:
            from app.services.notification import notify_users
            kind_label = {"record": "생기부", "submission": "수행평가"}.get(body.kind, body.kind)
            await notify_users(
                db, user_ids=teacher_ids,
                type="student_confirmation.revision",
                title=f"{kind_label} 수정 요청: {title}",
                body=f"{user.name} 학생이 수정을 요청했습니다."
                     + (f"\n사유: {row.comment}" if row.comment else ""),
                link_url="/record-writer" if body.kind == "record" else None,
                source_user_id=user.id,
            )
        except Exception:
            pass

    await db.commit()
    return _conf_dict(row)


@router.get("/returned-submissions")
async def my_returned_submissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """반환(채점)된 본인 클래스룸 과제 제출물 — 수행평가 점수·피드백 확인용."""
    rows = (await db.execute(
        select(CoursePostSubmission, CoursePost, Course)
        .join(CoursePost, CoursePost.id == CoursePostSubmission.post_id)
        .join(Course, Course.id == CoursePost.course_id)
        .where(
            CoursePostSubmission.student_id == user.id,
            CoursePostSubmission.status == "returned",
        )
        .order_by(CoursePostSubmission.returned_at.desc())
        .limit(200)
    )).all()
    return {
        "items": [
            {
                "submission_id": sub.id,
                "post_id": post.id,
                "post_title": post.title,
                "course_id": course.id,
                "course_name": course.name,
                "score": sub.score,
                "max_score": post.max_score,
                "feedback": sub.feedback,
                "returned_at": sub.returned_at.isoformat() if sub.returned_at else None,
            }
            for sub, post, course in rows
        ]
    }


@router.get("/grades-summary")
async def my_grades_summary(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학기별 지필 성적 묶음 — (year, semester) 그룹."""
    rows = (await db.execute(
        select(StudentGrade)
        .where(StudentGrade.student_id == user.id)
        .order_by(StudentGrade.year.desc(), StudentGrade.semester.desc(),
                  StudentGrade.subject, StudentGrade.exam_type)
        .limit(500)
    )).scalars().all()
    groups: dict[str, dict] = {}
    for g in rows:
        key = f"{g.year}-{g.semester}"
        grp = groups.setdefault(key, {
            "ref_key": key, "year": g.year, "semester": g.semester, "grades": [],
        })
        grp["grades"].append({
            "subject": g.subject,
            "exam_type": g.exam_type,
            "score": g.score,
            "max_score": g.max_score,
            "grade_rank": g.grade_rank,
            "average": g.average,
        })
    return {"items": list(groups.values())}
