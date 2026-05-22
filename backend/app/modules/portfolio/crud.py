"""포트폴리오 CRUD endpoints — 6개 리소스 (Grade/MockExam/Award/Thesis/Counseling/Record).

각 리소스마다 list + create + 일반 update/delete 라우트 등록.

router 객체는 router.py에서 공유. router.py 끝의 'from . import crud'로 등록.
"""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.portfolio import (
    StudentAward, StudentCounseling, StudentGrade, StudentMockExam,
    StudentRecord, StudentThesis,
)
from app.models.user import User
from app.modules.portfolio.router import router
from app.modules.portfolio.schemas import (
    AwardCreate, CounselingCreate, GradeCreate, MockExamCreate,
    RecordCreate, ThesisCreate,
)


# ── Grades (2FA) ──

@router.get("/{sid}/grades")
async def list_grades(
    sid: int,
    year: int | None = None, semester: int | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 성적 list — 페이지네이션. 3학년 12학기 × 10과목 × 2회 ≈ 720 가능."""
    await assert_can_view_student(db, user, sid)
    base_where = [StudentGrade.student_id == sid]
    if year:
        base_where.append(StudentGrade.year == year)
    if semester:
        base_where.append(StudentGrade.semester == semester)
    total = (await db.execute(
        select(func.count(StudentGrade.id)).where(*base_where)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentGrade).where(*base_where)
        .order_by(StudentGrade.year, StudentGrade.semester, StudentGrade.subject)
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": g.id, "year": g.year, "semester": g.semester,
            "exam_type": g.exam_type, "subject": g.subject,
            "score": g.score, "max_score": g.max_score,
            "grade_rank": g.grade_rank, "class_rank": g.class_rank,
            "total_students": g.total_students, "average": g.average,
            "standard_deviation": g.standard_deviation, "comment": g.comment,
        } for g in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/grades")
async def create_grade(
    sid: int, body: GradeCreate,
    user: User = Depends(require_permission("portfolio.grade.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    g = StudentGrade(
        student_id=sid, year=body.year, semester=body.semester,
        exam_type=body.exam_type, subject=body.subject,
        score=body.score, max_score=body.max_score,
        grade_rank=body.grade_rank, class_rank=body.class_rank,
        total_students=body.total_students, average=body.average,
        standard_deviation=body.standard_deviation, comment=body.comment,
    )
    db.add(g)
    await db.flush()
    await log_action(db, user, "grade.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": g.id}


# ── Mock Exams (2FA) ──

@router.get("/{sid}/mock-exams")
async def list_mock_exams(
    sid: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.mockexam.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    total = (await db.execute(
        select(func.count(StudentMockExam.id))
        .where(StudentMockExam.student_id == sid)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentMockExam).where(StudentMockExam.student_id == sid)
        .order_by(desc(StudentMockExam.exam_date))
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": m.id, "exam_name": m.exam_name, "exam_date": m.exam_date.isoformat(),
            "subject": m.subject, "raw_score": m.raw_score,
            "standard_score": m.standard_score, "percentile": m.percentile,
            "grade_level": m.grade_level,
        } for m in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/mock-exams")
async def create_mock_exam(
    sid: int, body: MockExamCreate,
    user: User = Depends(require_permission("portfolio.mockexam.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    m = StudentMockExam(
        student_id=sid, exam_name=body.exam_name,
        exam_date=body.exam_date, subject=body.subject,
        raw_score=body.raw_score,
        standard_score=body.standard_score,
        percentile=body.percentile,
        grade_level=body.grade_level,
    )
    db.add(m)
    await db.flush()
    await log_action(db, user, "mockexam.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": m.id}


# ── Awards ──

@router.get("/{sid}/awards")
async def list_awards(
    sid: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.award.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    total = (await db.execute(
        select(func.count(StudentAward.id))
        .where(StudentAward.student_id == sid)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentAward).where(StudentAward.student_id == sid)
        .order_by(desc(StudentAward.award_date))
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": a.id, "title": a.title, "award_type": a.award_type,
            "category": a.category, "award_level": a.award_level,
            "award_date": a.award_date.isoformat(), "organizer": a.organizer,
            "description": a.description,
        } for a in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/awards")
async def create_award(
    sid: int, body: AwardCreate,
    user: User = Depends(require_permission("portfolio.award.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    a = StudentAward(
        student_id=sid, title=body.title,
        award_type=body.award_type, category=body.category,
        award_level=body.award_level, award_date=body.award_date,
        organizer=body.organizer, description=body.description,
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "award.create", f"student:{sid}", request=request)
    return {"id": a.id}


# ── Theses ──

@router.get("/{sid}/theses")
async def list_theses(
    sid: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.thesis.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    total = (await db.execute(
        select(func.count(StudentThesis.id))
        .where(StudentThesis.student_id == sid)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentThesis).where(StudentThesis.student_id == sid)
        .order_by(desc(StudentThesis.created_at))
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": t.id, "title": t.title, "thesis_type": t.thesis_type,
            "abstract": t.abstract, "status": t.status,
            "journal": t.journal, "coauthors": t.coauthors,
        } for t in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/theses")
async def create_thesis(
    sid: int, body: ThesisCreate,
    user: User = Depends(require_permission("portfolio.thesis.edit")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    t = StudentThesis(
        student_id=sid, title=body.title,
        thesis_type=body.thesis_type, abstract=body.abstract,
        advisor_id=body.advisor_id, coauthors=body.coauthors,
        journal=body.journal, status=body.status,
    )
    db.add(t)
    await db.flush()
    return {"id": t.id}


# ── Counseling (2FA) ──

@router.get("/{sid}/counselings")
async def list_counselings(
    sid: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.counseling.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    base_where = [StudentCounseling.student_id == sid]
    if user.role not in ("super_admin", "designated_admin"):
        base_where.append(StudentCounseling.counselor_id == user.id)
    total = (await db.execute(
        select(func.count(StudentCounseling.id)).where(*base_where)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentCounseling).where(*base_where)
        .order_by(desc(StudentCounseling.counseling_date))
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": c.id, "counseling_date": c.counseling_date.isoformat(),
            "counseling_type": c.counseling_type, "title": c.title,
            "content": c.content, "follow_up": c.follow_up,
        } for c in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/counselings")
async def create_counseling(
    sid: int, body: CounselingCreate,
    user: User = Depends(require_permission("portfolio.counseling.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    c = StudentCounseling(
        student_id=sid, counselor_id=user.id,
        counseling_date=body.counseling_date,
        counseling_type=body.counseling_type,
        title=body.title, content=body.content,
        follow_up=body.follow_up,
    )
    db.add(c)
    await db.flush()
    await log_action(db, user, "counseling.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": c.id}


# ── Records (2FA) ──

@router.get("/{sid}/records")
async def list_records(
    sid: int, year: int | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("portfolio.record.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    base_where = [StudentRecord.student_id == sid]
    if year:
        base_where.append(StudentRecord.year == year)
    total = (await db.execute(
        select(func.count(StudentRecord.id)).where(*base_where)
    )).scalar() or 0
    rows = (await db.execute(
        select(StudentRecord).where(*base_where)
        .order_by(StudentRecord.year, StudentRecord.semester)
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "items": [{
            "id": r.id, "year": r.year, "semester": r.semester,
            "record_type": r.record_type, "content": r.content,
        } for r in rows],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/{sid}/records")
async def create_record(
    sid: int, body: RecordCreate,
    user: User = Depends(require_permission("portfolio.record.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    r = StudentRecord(
        student_id=sid, year=body.year, semester=body.semester,
        record_type=body.record_type, content=body.content,
    )
    db.add(r)
    await db.flush()
    await log_action(db, user, "record.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": r.id}


# ── Portfolio Summary ──

@router.get("/{sid}/portfolio")
async def get_portfolio(
    sid: int,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 종합 포트폴리오 요약 (행 개수 카운트)."""
    await assert_can_view_student(db, user, sid)
    student = (await db.execute(select(User).where(User.id == sid))).scalar_one_or_none()
    if not student or student.role != "student":
        raise HTTPException(404, "학생을 찾을 수 없습니다")

    grades = (await db.execute(select(StudentGrade).where(StudentGrade.student_id == sid))).scalars().all()
    awards = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
    theses = (await db.execute(select(StudentThesis).where(StudentThesis.student_id == sid))).scalars().all()
    mock_exams = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()

    return {
        "student": {"id": student.id, "name": student.name, "grade": student.grade,
                     "class_number": student.class_number, "student_number": student.student_number},
        "grade_count": len(grades),
        "award_count": len(awards),
        "thesis_count": len(theses),
        "mock_exam_count": len(mock_exams),
    }


# ── 일반 CRUD UPDATE/DELETE 팩토리 (각 entity) ──

def _generic_update(model_cls, sensitive: bool, perm: str):
    async def _handler(
        sid: int, oid: int, body: dict, request: Request,
        user: User = Depends(require_permission(perm)),
        db: AsyncSession = Depends(get_db),
    ):
        obj = (await db.execute(select(model_cls).where(model_cls.id == oid, model_cls.student_id == sid))).scalar_one_or_none()
        if not obj:
            raise HTTPException(404)
        for k, v in body.items():
            if hasattr(obj, k):
                setattr(obj, k, v)
        await log_action(db, user, f"{model_cls.__tablename__}.update", f"id:{oid}", request=request, is_sensitive=sensitive)
        return {"ok": True}
    return _handler


def _generic_delete(model_cls, sensitive: bool, perm: str):
    async def _handler(
        sid: int, oid: int, request: Request,
        user: User = Depends(require_permission(perm)),
        db: AsyncSession = Depends(get_db),
    ):
        obj = (await db.execute(select(model_cls).where(model_cls.id == oid, model_cls.student_id == sid))).scalar_one_or_none()
        if not obj:
            raise HTTPException(404)
        await db.delete(obj)
        await log_action(db, user, f"{model_cls.__tablename__}.delete", f"id:{oid}", request=request, is_sensitive=sensitive)
        return {"ok": True}
    return _handler


# 라우트 등록 (UPDATE/DELETE) — 팩토리 정의 직후 등록
router.put("/{sid}/grades/{oid}")(_generic_update(StudentGrade, True, "portfolio.grade.edit"))
router.delete("/{sid}/grades/{oid}")(_generic_delete(StudentGrade, True, "portfolio.grade.edit"))
router.put("/{sid}/awards/{oid}")(_generic_update(StudentAward, False, "portfolio.award.edit"))
router.delete("/{sid}/awards/{oid}")(_generic_delete(StudentAward, False, "portfolio.award.edit"))
router.put("/{sid}/theses/{oid}")(_generic_update(StudentThesis, False, "portfolio.thesis.edit"))
router.delete("/{sid}/theses/{oid}")(_generic_delete(StudentThesis, False, "portfolio.thesis.edit"))
router.put("/{sid}/mock-exams/{oid}")(_generic_update(StudentMockExam, True, "portfolio.mockexam.edit"))
router.delete("/{sid}/mock-exams/{oid}")(_generic_delete(StudentMockExam, True, "portfolio.mockexam.edit"))
router.put("/{sid}/counselings/{oid}")(_generic_update(StudentCounseling, True, "portfolio.counseling.edit"))
router.delete("/{sid}/counselings/{oid}")(_generic_delete(StudentCounseling, True, "portfolio.counseling.edit"))
router.put("/{sid}/records/{oid}")(_generic_update(StudentRecord, True, "portfolio.record.edit"))
router.delete("/{sid}/records/{oid}")(_generic_delete(StudentRecord, True, "portfolio.record.edit"))
