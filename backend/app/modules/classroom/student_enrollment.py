"""학생 수강과목 CSV 일괄 등록 (super_admin/지정관리자 용).

엔드포인트:
  GET  /api/classroom/_enrollment/csv-template          — CSV 양식 다운로드
  POST /api/classroom/_enrollment/import                — 학번 + 강좌 매핑 일괄 등록
  POST /api/classroom/_enrollment/import/dry-run        — 검증만 (영향 미리보기)

CSV 형식 (UTF-8 BOM):
  student_number,course_id
  10101,42
  10101,43
  ...

또는 강좌 ID 대신 과목명 + 학년 (학기 안에서 unique):
  student_number,subject,grade_level
  10101,수학I,1
  10101,영어I,1

원칙:
  - 학기는 현재 active 학기 사용
  - 멱등 (이미 active면 skip, dropped→active 재활성화)
  - student_number는 User.student_number와 매칭 (5자리: 10101=1학년1반01번)
"""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.core.upload import POLICY_CSV, validate_upload
from app.models import Course, CourseStudent, User
from app.modules.classroom.router import router


CSV_HEADERS = ["student_number", "course_id", "subject", "grade_level"]


@router.get("/_enrollment/csv-template")
async def enrollment_csv_template(
    user: User = Depends(require_permission("classroom.course.manage")),
):
    """수강과목 일괄 등록 CSV 양식 다운로드.

    student_number는 필수. course_id 또는 (subject + grade_level) 중 하나 채움.
    """
    output = io.StringIO()
    output.write("﻿")  # UTF-8 BOM (Excel 호환)
    writer = csv.writer(output)
    writer.writerow(CSV_HEADERS)
    writer.writerow(["10101", "", "수학I", "1"])
    writer.writerow(["10101", "", "영어I", "1"])
    writer.writerow(["10102", "42", "", ""])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=enrollment_template.csv"},
    )


async def _parse_csv(content: bytes) -> tuple[list[dict[str, Any]], list[str]]:
    """CSV 파싱. (rows, errors)."""
    errors: list[str] = []
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("cp949")
        except UnicodeDecodeError:
            errors.append("CSV 인코딩을 읽을 수 없습니다 (UTF-8 또는 CP949)")
            return [], errors

    reader = csv.DictReader(io.StringIO(text))
    rows = []
    MAX_ROWS = 5000  # 1500명 × 3과목 ≈ 4500 → 5000 한도. DoS 차단.
    for i, row in enumerate(reader, start=2):
        if len(rows) >= MAX_ROWS:
            errors.append(f"CSV 행이 {MAX_ROWS}개를 초과합니다 — 분할해서 업로드하세요")
            break
        clean = {k: (v or "").strip() for k, v in row.items()}
        clean["_line"] = i
        rows.append(clean)
    return rows, errors


@router.post("/_enrollment/import")
async def import_enrollment_csv(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = False,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학생 수강과목 일괄 등록 CSV.

    각 행:
      student_number,course_id,subject,grade_level
    course_id 비어 있으면 (subject + grade_level)로 강좌 검색.
    """
    if user.role not in ("super_admin", "designated_admin"):
        raise HTTPException(403, "관리자만 실행할 수 있습니다")

    sid = await get_active_semester_id_or_404(db)
    # 확장자·크기·MIME 검증 (POLICY_CSV)
    content = await validate_upload(file, POLICY_CSV)
    rows, parse_errors = await _parse_csv(content)
    if parse_errors:
        return {"errors": parse_errors, "added": 0, "skipped": 0, "reactivated": 0}

    # 학번 → User 매핑 (한 번에 조회)
    snums = {int(r["student_number"]) for r in rows if r.get("student_number", "").isdigit()}
    students = (await db.execute(
        select(User).where(
            User.role == "student",
            User.student_number.in_(snums),
            User.status != "disabled",
        )
    )).scalars().all() if snums else []
    student_by_snum = {s.student_number: s for s in students}

    # 미리 매핑 단순화 — (subject, grade_level) → course_id
    courses_by_id = {
        c.id: c for c in (await db.execute(
            select(Course).where(Course.semester_id == sid)
        )).scalars().all()
    }
    courses_by_key: dict[tuple[str, int | None], Course] = {}
    for c in courses_by_id.values():
        if c.subject:
            courses_by_key[(c.subject.strip(), c.grade_level)] = c

    added = 0
    skipped = 0
    reactivated = 0
    errors: list[str] = []
    affected: list[tuple[int, int]] = []  # (course_id, student_id)

    for r in rows:
        line = r.get("_line", 0)
        snum_str = r.get("student_number", "")
        if not snum_str.isdigit():
            errors.append(f"line {line}: 학번이 숫자가 아님")
            continue
        snum = int(snum_str)
        student = student_by_snum.get(snum)
        if not student:
            errors.append(f"line {line}: 학번 {snum} 학생을 찾을 수 없음")
            continue

        course: Course | None = None
        if r.get("course_id", "").isdigit():
            course = courses_by_id.get(int(r["course_id"]))
        if not course:
            subject = r.get("subject", "").strip()
            grade_str = r.get("grade_level", "").strip()
            grade_level: int | None = None
            if grade_str.isdigit():
                grade_level = int(grade_str)
            if subject:
                course = courses_by_key.get((subject, grade_level))
                if not course:
                    # grade_level 무시하고 매칭 (None=any)
                    for (s, _), c in courses_by_key.items():
                        if s == subject:
                            course = c
                            break
        if not course:
            errors.append(f"line {line}: 강좌를 찾을 수 없음 (course_id/subject/grade_level 확인)")
            continue

        existing = (await db.execute(
            select(CourseStudent).where(
                CourseStudent.course_id == course.id,
                CourseStudent.student_id == student.id,
            )
        )).scalar_one_or_none()
        if existing:
            if existing.status == "active":
                skipped += 1
            else:
                if not dry_run:
                    existing.status = "active"
                reactivated += 1
                affected.append((course.id, student.id))
            continue

        if not dry_run:
            db.add(CourseStudent(course_id=course.id, student_id=student.id, status="active"))
        added += 1
        affected.append((course.id, student.id))

    if not dry_run:
        await db.flush()
        # 영향 받은 학생들 폴더 자동 동기화 (best-effort)
        try:
            from app.services.folder_seed import on_course_student_enrolled
            for cid, sid_user in affected:
                await on_course_student_enrolled(db, course_id=cid, student_id=sid_user)
        except Exception:
            pass
        await log_action(
            db, user, "enrollment.csv.import",
            detail=f"added={added} reactivated={reactivated} skipped={skipped} errors={len(errors)}",
            request=request,
        )

    return {
        "dry_run": dry_run,
        "added": added,
        "reactivated": reactivated,
        "skipped": skipped,
        "errors": errors,
    }
