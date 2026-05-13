"""포트폴리오 CSV import/export

자체 양식 (UTF-8, 헤더 첫 줄). 각 type별 컬럼:

grades:
  student_id, year, semester, exam_type, subject, score, max_score,
  grade_rank, class_rank, total_students, average, comment

awards:
  student_id, title, award_type, category, award_level, award_date,
  organizer, description

mockexam:
  student_id, exam_name, exam_date, subject, raw_score,
  standard_score, percentile, grade_level

counseling:
  student_id, counselor_username, counseling_date, counseling_type,
  title, content, follow_up

records:
  student_id, year, semester, record_type, content
"""

import csv
import io
from datetime import date, datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio import (
    StudentAward, StudentCounseling, StudentGrade,
    StudentMockExam, StudentRecord,
)
from app.models.user import User


CSV_TEMPLATES = {
    "grades": [
        "student_id", "year", "semester", "exam_type", "subject", "score",
        "max_score", "grade_rank", "class_rank", "total_students", "average", "comment",
    ],
    "awards": [
        "student_id", "title", "award_type", "category", "award_level",
        "award_date", "organizer", "description",
    ],
    "mockexam": [
        "student_id", "exam_name", "exam_date", "subject", "raw_score",
        "standard_score", "percentile", "grade_level",
    ],
    "counseling": [
        "student_id", "counselor_username", "counseling_date", "counseling_type",
        "title", "content", "follow_up",
    ],
    "records": [
        "student_id", "year", "semester", "record_type", "content",
    ],
}


def _to_int(v: str) -> int | None:
    v = (v or "").strip()
    return int(v) if v else None


def _to_float(v: str) -> float | None:
    v = (v or "").strip()
    return float(v) if v else None


def _to_date(v: str) -> date | None:
    v = (v or "").strip()
    if not v:
        return None
    return datetime.strptime(v, "%Y-%m-%d").date()


def _row_grade(row: dict) -> StudentGrade:
    return StudentGrade(
        student_id=int(row["student_id"]), year=int(row["year"]),
        semester=int(row["semester"]), exam_type=row["exam_type"],
        subject=row["subject"], score=float(row["score"]),
        max_score=_to_float(row.get("max_score", "100")) or 100.0,
        grade_rank=_to_int(row.get("grade_rank", "")),
        class_rank=_to_int(row.get("class_rank", "")),
        total_students=_to_int(row.get("total_students", "")),
        average=_to_float(row.get("average", "")),
        comment=(row.get("comment") or "").strip() or None,
    )


def _row_award(row: dict) -> StudentAward:
    return StudentAward(
        student_id=int(row["student_id"]), title=row["title"],
        award_type=row["award_type"], category=row["category"],
        award_level=row["award_level"], award_date=_to_date(row["award_date"]),
        organizer=(row.get("organizer") or "").strip() or None,
        description=(row.get("description") or "").strip() or None,
    )


def _row_mockexam(row: dict) -> StudentMockExam:
    return StudentMockExam(
        student_id=int(row["student_id"]), exam_name=row["exam_name"],
        exam_date=_to_date(row["exam_date"]), subject=row["subject"],
        raw_score=float(row["raw_score"]),
        standard_score=_to_float(row.get("standard_score", "")),
        percentile=_to_float(row.get("percentile", "")),
        grade_level=_to_int(row.get("grade_level", "")),
    )


async def _row_counseling(row: dict, db: AsyncSession) -> StudentCounseling:
    counselor_id = None
    cu = (row.get("counselor_username") or "").strip()
    if cu:
        u = (await db.execute(select(User).where(User.username == cu))).scalar_one_or_none()
        if u:
            counselor_id = u.id
    return StudentCounseling(
        student_id=int(row["student_id"]),
        counselor_id=counselor_id or 0,
        counseling_date=_to_date(row["counseling_date"]),
        counseling_type=row["counseling_type"],
        title=row["title"], content=row["content"],
        follow_up=(row.get("follow_up") or "").strip() or None,
    )


def _row_record(row: dict) -> StudentRecord:
    return StudentRecord(
        student_id=int(row["student_id"]), year=int(row["year"]),
        semester=int(row["semester"]), record_type=row["record_type"],
        content=row["content"],
    )


async def import_csv(db: AsyncSession, csv_type: str, file_bytes: bytes, dry_run: bool = False) -> dict:
    """returns: {ok_count, errors: [{row, error}]}"""
    if csv_type not in CSV_TEMPLATES:
        raise ValueError(f"unknown csv_type: {csv_type}")

    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    expected = set(CSV_TEMPLATES[csv_type])
    missing = expected - set([f.strip() for f in (reader.fieldnames or [])])
    # 필수만 검증 (옵션 컬럼은 누락 OK). 핵심 키 최소 검증:
    required = {
        "grades": {"student_id", "year", "semester", "exam_type", "subject", "score"},
        "awards": {"student_id", "title", "award_type", "category", "award_level", "award_date"},
        "mockexam": {"student_id", "exam_name", "exam_date", "subject", "raw_score"},
        "counseling": {"student_id", "counseling_date", "counseling_type", "title", "content"},
        "records": {"student_id", "year", "semester", "record_type", "content"},
    }[csv_type]
    missing_required = required - set([f.strip() for f in (reader.fieldnames or [])])
    if missing_required:
        return {"ok_count": 0, "errors": [{"row": 0, "error": f"필수 컬럼 누락: {sorted(missing_required)}"}]}

    ok_count = 0
    errors: list[dict] = []
    rows_to_add = []
    for i, row in enumerate(reader, start=2):  # 헤더가 1번 줄
        try:
            if csv_type == "grades":
                obj = _row_grade(row)
            elif csv_type == "awards":
                obj = _row_award(row)
            elif csv_type == "mockexam":
                obj = _row_mockexam(row)
            elif csv_type == "counseling":
                obj = await _row_counseling(row, db)
            elif csv_type == "records":
                obj = _row_record(row)
            rows_to_add.append(obj)
            ok_count += 1
        except Exception as e:
            errors.append({"row": i, "error": f"{type(e).__name__}: {e}"})

    if not dry_run and rows_to_add:
        for obj in rows_to_add:
            db.add(obj)
        await db.flush()

    return {"ok_count": ok_count, "errors": errors, "dry_run": dry_run}


def export_csv(rows: list, csv_type: str) -> str:
    """rows를 CSV 문자열로 변환"""
    cols = CSV_TEMPLATES[csv_type]
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=cols, extrasaction="ignore")
    w.writeheader()

    if csv_type == "grades":
        for r in rows:
            w.writerow({
                "student_id": r.student_id, "year": r.year, "semester": r.semester,
                "exam_type": r.exam_type, "subject": r.subject, "score": r.score,
                "max_score": r.max_score, "grade_rank": r.grade_rank or "",
                "class_rank": r.class_rank or "", "total_students": r.total_students or "",
                "average": r.average or "", "comment": r.comment or "",
            })
    elif csv_type == "awards":
        for r in rows:
            w.writerow({
                "student_id": r.student_id, "title": r.title,
                "award_type": r.award_type, "category": r.category,
                "award_level": r.award_level,
                "award_date": r.award_date.isoformat() if r.award_date else "",
                "organizer": r.organizer or "", "description": r.description or "",
            })
    elif csv_type == "mockexam":
        for r in rows:
            w.writerow({
                "student_id": r.student_id, "exam_name": r.exam_name,
                "exam_date": r.exam_date.isoformat() if r.exam_date else "",
                "subject": r.subject, "raw_score": r.raw_score,
                "standard_score": r.standard_score or "",
                "percentile": r.percentile or "",
                "grade_level": r.grade_level or "",
            })
    elif csv_type == "counseling":
        for r in rows:
            w.writerow({
                "student_id": r.student_id, "counselor_username": "",
                "counseling_date": r.counseling_date.isoformat() if r.counseling_date else "",
                "counseling_type": r.counseling_type, "title": r.title,
                "content": r.content, "follow_up": r.follow_up or "",
            })
    elif csv_type == "records":
        for r in rows:
            w.writerow({
                "student_id": r.student_id, "year": r.year, "semester": r.semester,
                "record_type": r.record_type, "content": r.content,
            })

    return out.getvalue()


def template_csv(csv_type: str) -> str:
    """빈 템플릿 (헤더만)"""
    return ",".join(CSV_TEMPLATES[csv_type]) + "\n"
