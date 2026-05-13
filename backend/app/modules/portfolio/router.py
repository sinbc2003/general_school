"""학생 포트폴리오 라우터 — 성적, 수상, 논문, 상담, 모의고사, 생기부

CSV import/export, 다년치 통계, PDF 생기부 보조자료 출력 포함.
"""

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.visibility import assert_can_view_student
from app.models.portfolio import (
    StudentGrade, StudentMockExam, StudentAward,
    StudentThesis, StudentCounseling, StudentRecord,
)
from app.models.student_self import StudentArtifact, StudentCareerPlan
from app.models.user import User
from app.services.portfolio_io import (
    CSV_TEMPLATES, export_csv, import_csv, template_csv,
)
from app.services.report_pdf import generate_student_pdf

router = APIRouter(prefix="/api/students", tags=["students"])


# ── Grades (2FA) ──

@router.get("/{sid}/grades")
async def list_grades(
    sid: int,
    year: int | None = None, semester: int | None = None,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    q = select(StudentGrade).where(StudentGrade.student_id == sid)
    if year:
        q = q.where(StudentGrade.year == year)
    if semester:
        q = q.where(StudentGrade.semester == semester)
    rows = (await db.execute(q.order_by(StudentGrade.year, StudentGrade.semester, StudentGrade.subject))).scalars().all()
    return [{
        "id": g.id, "year": g.year, "semester": g.semester,
        "exam_type": g.exam_type, "subject": g.subject,
        "score": g.score, "max_score": g.max_score,
        "grade_rank": g.grade_rank, "class_rank": g.class_rank,
        "total_students": g.total_students, "average": g.average,
        "standard_deviation": g.standard_deviation, "comment": g.comment,
    } for g in rows]


@router.post("/{sid}/grades")
async def create_grade(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.grade.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    g = StudentGrade(
        student_id=sid, year=body["year"], semester=body["semester"],
        exam_type=body["exam_type"], subject=body["subject"],
        score=body["score"], max_score=body.get("max_score", 100),
        grade_rank=body.get("grade_rank"), class_rank=body.get("class_rank"),
        total_students=body.get("total_students"), average=body.get("average"),
        standard_deviation=body.get("standard_deviation"), comment=body.get("comment"),
    )
    db.add(g)
    await db.flush()
    await log_action(db, user, "grade.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": g.id}


# ── Mock Exams (2FA) ──

@router.get("/{sid}/mock-exams")
async def list_mock_exams(
    sid: int,
    user: User = Depends(require_permission("portfolio.mockexam.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    rows = (await db.execute(
        select(StudentMockExam).where(StudentMockExam.student_id == sid)
        .order_by(desc(StudentMockExam.exam_date))
    )).scalars().all()
    return [{
        "id": m.id, "exam_name": m.exam_name, "exam_date": m.exam_date.isoformat(),
        "subject": m.subject, "raw_score": m.raw_score,
        "standard_score": m.standard_score, "percentile": m.percentile,
        "grade_level": m.grade_level,
    } for m in rows]


@router.post("/{sid}/mock-exams")
async def create_mock_exam(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.mockexam.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    m = StudentMockExam(
        student_id=sid, exam_name=body["exam_name"],
        exam_date=body["exam_date"], subject=body["subject"],
        raw_score=body["raw_score"],
        standard_score=body.get("standard_score"),
        percentile=body.get("percentile"),
        grade_level=body.get("grade_level"),
    )
    db.add(m)
    await db.flush()
    await log_action(db, user, "mockexam.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": m.id}


# ── Awards ──

@router.get("/{sid}/awards")
async def list_awards(
    sid: int,
    user: User = Depends(require_permission("portfolio.award.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    rows = (await db.execute(
        select(StudentAward).where(StudentAward.student_id == sid)
        .order_by(desc(StudentAward.award_date))
    )).scalars().all()
    return [{
        "id": a.id, "title": a.title, "award_type": a.award_type,
        "category": a.category, "award_level": a.award_level,
        "award_date": a.award_date.isoformat(), "organizer": a.organizer,
        "description": a.description,
    } for a in rows]


@router.post("/{sid}/awards")
async def create_award(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.award.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    a = StudentAward(
        student_id=sid, title=body["title"],
        award_type=body["award_type"], category=body["category"],
        award_level=body["award_level"], award_date=body["award_date"],
        organizer=body.get("organizer"), description=body.get("description"),
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "award.create", f"student:{sid}", request=request)
    return {"id": a.id}


# ── Theses ──

@router.get("/{sid}/theses")
async def list_theses(
    sid: int,
    user: User = Depends(require_permission("portfolio.thesis.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    rows = (await db.execute(
        select(StudentThesis).where(StudentThesis.student_id == sid)
        .order_by(desc(StudentThesis.created_at))
    )).scalars().all()
    return [{
        "id": t.id, "title": t.title, "thesis_type": t.thesis_type,
        "abstract": t.abstract, "status": t.status,
        "journal": t.journal, "coauthors": t.coauthors,
    } for t in rows]


@router.post("/{sid}/theses")
async def create_thesis(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.thesis.edit")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    t = StudentThesis(
        student_id=sid, title=body["title"],
        thesis_type=body["thesis_type"], abstract=body.get("abstract"),
        advisor_id=body.get("advisor_id"), coauthors=body.get("coauthors"),
        journal=body.get("journal"), status=body.get("status", "in_progress"),
    )
    db.add(t)
    await db.flush()
    return {"id": t.id}


# ── Counseling (2FA) ──

@router.get("/{sid}/counselings")
async def list_counselings(
    sid: int,
    user: User = Depends(require_permission("portfolio.counseling.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    q = select(StudentCounseling).where(StudentCounseling.student_id == sid)
    if user.role not in ("super_admin", "designated_admin"):
        q = q.where(StudentCounseling.counselor_id == user.id)
    rows = (await db.execute(q.order_by(desc(StudentCounseling.counseling_date)))).scalars().all()
    return [{
        "id": c.id, "counseling_date": c.counseling_date.isoformat(),
        "counseling_type": c.counseling_type, "title": c.title,
        "content": c.content, "follow_up": c.follow_up,
    } for c in rows]


@router.post("/{sid}/counselings")
async def create_counseling(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.counseling.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    c = StudentCounseling(
        student_id=sid, counselor_id=user.id,
        counseling_date=body["counseling_date"],
        counseling_type=body["counseling_type"],
        title=body["title"], content=body["content"],
        follow_up=body.get("follow_up"),
    )
    db.add(c)
    await db.flush()
    await log_action(db, user, "counseling.create", f"student:{sid}", request=request, is_sensitive=True)
    return {"id": c.id}


# ── Records (2FA) ──

@router.get("/{sid}/records")
async def list_records(
    sid: int, year: int | None = None,
    user: User = Depends(require_permission("portfolio.record.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    q = select(StudentRecord).where(StudentRecord.student_id == sid)
    if year:
        q = q.where(StudentRecord.year == year)
    rows = (await db.execute(q.order_by(StudentRecord.year, StudentRecord.semester))).scalars().all()
    return [{
        "id": r.id, "year": r.year, "semester": r.semester,
        "record_type": r.record_type, "content": r.content,
    } for r in rows]


@router.post("/{sid}/records")
async def create_record(
    sid: int, body: dict,
    user: User = Depends(require_permission("portfolio.record.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    await assert_can_view_student(db, user, sid)
    r = StudentRecord(
        student_id=sid, year=body["year"], semester=body["semester"],
        record_type=body["record_type"], content=body["content"],
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
    await assert_can_view_student(db, user, sid)
    """학생 종합 포트폴리오"""
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


# ── 일반 CRUD UPDATE/DELETE (각 entity) ──

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


# 라우트 등록 (UPDATE/DELETE)
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


# ── 통계 / 타임라인 ──

@router.get("/{sid}/stats")
async def portfolio_stats(
    sid: int,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    """학생 다년치 누적 통계 — 학년/학기별 평균, 수상 개수, 상담 개수, 모의고사 등급 추이"""
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
    await assert_can_view_student(db, user, sid)
    """학생 활동 타임라인 — 모든 활동을 시간순으로 통합"""
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


# ── CSV import/export ──

@router.get("/_io/csv-template/{csv_type}")
async def csv_template(
    csv_type: str,
    user: User = Depends(require_permission("portfolio.grade.view")),
):
    """빈 CSV 템플릿 다운로드"""
    if csv_type not in CSV_TEMPLATES:
        raise HTTPException(400, f"unknown type. valid: {list(CSV_TEMPLATES.keys())}")
    content = template_csv(csv_type)
    return Response(
        content="﻿" + content,  # BOM for Excel
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="template_{csv_type}.csv"'},
    )


@router.post("/_io/import/{csv_type}")
async def import_portfolio_csv(
    csv_type: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    request: Request = None,
    user: User = Depends(require_permission("portfolio.grade.edit")),
    db: AsyncSession = Depends(get_db),
):
    """CSV 일괄 업로드 (dry_run=true로 검증만 가능)"""
    if csv_type not in CSV_TEMPLATES:
        raise HTTPException(400, f"unknown type. valid: {list(CSV_TEMPLATES.keys())}")
    raw = await file.read()
    result = await import_csv(db, csv_type, raw, dry_run=dry_run)
    if not dry_run:
        await log_action(db, user, f"portfolio.import.{csv_type}",
                         f"ok={result['ok_count']}, errors={len(result['errors'])}",
                         request=request, is_sensitive=True)
    return result


@router.get("/{sid}/export.csv")
async def export_student_csv(
    sid: int,
    types: str = Query("grades,awards,mockexam,counseling,records"),
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    """학생 단일 데이터 CSV 묶음 (각 type 섹션)"""
    type_list = [t.strip() for t in types.split(",") if t.strip() in CSV_TEMPLATES]

    parts: list[str] = []
    for t in type_list:
        if t == "grades":
            rows = (await db.execute(select(StudentGrade).where(StudentGrade.student_id == sid))).scalars().all()
        elif t == "awards":
            rows = (await db.execute(select(StudentAward).where(StudentAward.student_id == sid))).scalars().all()
        elif t == "mockexam":
            rows = (await db.execute(select(StudentMockExam).where(StudentMockExam.student_id == sid))).scalars().all()
        elif t == "counseling":
            rows = (await db.execute(select(StudentCounseling).where(StudentCounseling.student_id == sid))).scalars().all()
        elif t == "records":
            rows = (await db.execute(select(StudentRecord).where(StudentRecord.student_id == sid))).scalars().all()
        else:
            continue
        parts.append(f"# {t}\n" + export_csv(rows, t))

    content = "\n\n".join(parts) if parts else ""
    return Response(
        content="﻿" + content, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="student_{sid}_export.csv"'},
    )


# ── PDF 생기부 보조자료 ──

@router.get("/{sid}/report.pdf")
async def student_report_pdf(
    sid: int, request: Request,
    user: User = Depends(require_permission("portfolio.grade.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    """학생 종합 포트폴리오 PDF (생기부 양식 모방)"""
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

    pdf_bytes = generate_student_pdf(
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
        headers={"Content-Disposition": f'inline; filename="{student.name}_portfolio.pdf"'},
    )


# ── 교사용: 특정 학생의 산출물 / 진로 계획 조회 ──
# (학생 본인은 /api/me/artifacts, /api/me/career-plans 사용)

@router.get("/{sid}/artifacts")
async def list_student_artifacts(
    sid: int,
    category: str | None = None,
    user: User = Depends(require_permission("portfolio.artifact.view")),
    db: AsyncSession = Depends(get_db),
):
    await assert_can_view_student(db, user, sid)
    """교사가 특정 학생의 산출물 조회 (지도 목적)"""
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
    await assert_can_view_student(db, user, sid)
    """교사가 특정 학생의 진로/진학 설계 조회 (지도 목적)"""
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


# ── 교사용: 모든 학생의 공개 산출물 갤러리 (전체 학생 둘러보기) ──

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
