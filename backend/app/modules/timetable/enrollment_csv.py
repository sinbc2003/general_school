"""학기 enrollment CSV 일괄 등록 + 진급 마법사 endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import enrollment_csv'로 등록.
"""

from fastapi import BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_semester_by_id_or_404
from app.models.timetable import SemesterEnrollment
from app.models.user import User
from app.modules.timetable.schemas import PromoteRequest
from app.services.semester_import import (
    import_enrollments_csv,
    template_csv as semester_template_csv,
)

from app.modules.timetable.router import router


@router.get("/enrollments/csv-template/{role}")
async def get_csv_template(
    role: str,
    full: bool = Query(False, description="True면 담임/수업 학년 등 모든 컬럼 포함"),
    user: User = Depends(require_permission("system.enrollment.manage")),
):
    """CSV 양식 다운로드. role: teacher | student.

    full=False (기본): 최소 컬럼만 (이름·핸드폰).
    full=True: 모든 컬럼 (담임/수업 학년 등 — 비워두고 웹에서 추후 입력 가능).
    """
    if role not in ("teacher", "student"):
        raise HTTPException(400, "role must be teacher|student")
    body = semester_template_csv(role, full=full)
    suffix = "_full" if full else ""
    fname = f"{role}{suffix}_template.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/semesters/{sid}/import-enrollments")
async def import_enrollments_endpoint(
    sid: int,
    role: str = Query(..., description="teacher | student"),
    dry_run: bool = Query(False),
    file: UploadFile = File(...),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학기별 명단 CSV 일괄 업로드.

    - role=teacher: department, name, phone
    - role=student: student_no, name, phone
    이름이 username이 되고, phone(숫자만)이 초기 비밀번호, must_change_password=True.
    """
    await get_semester_by_id_or_404(db, sid)
    if role not in ("teacher", "student"):
        raise HTTPException(400, "role must be teacher|student")

    from app.core.upload import validate_upload, POLICY_CSV
    file_bytes = await validate_upload(file, POLICY_CSV)
    result = await import_enrollments_csv(db, sid, role, file_bytes, dry_run=dry_run)

    if not dry_run:
        await log_action(
            db, user, "enrollment.import",
            f"sem:{sid}/role:{role} ok={result['ok_count']} created={result['created_users']} reused={result['reused_users']}",
            request=request,
        )
    return result


@router.post("/semesters/{from_sid}/promote-to/{to_sid}")
async def promote_enrollments(
    from_sid: int, to_sid: int,
    background: BackgroundTasks,
    body: PromoteRequest = PromoteRequest(),
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """이전 학기 명단을 대상 학기로 복제하면서 진급/졸업 처리."""
    promote_students = body.promote_students
    graduate_grade = body.graduate_grade
    copy_teachers = body.copy_teachers
    dry_run = body.dry_run

    await get_semester_by_id_or_404(db, from_sid)
    await get_semester_by_id_or_404(db, to_sid)

    src = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == from_sid,
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    # 이미 대상 학기에 있는 user_id는 건너뜀
    existing_uids = set(
        (await db.execute(
            select(SemesterEnrollment.user_id).where(
                SemesterEnrollment.semester_id == to_sid
            )
        )).scalars().all()
    )

    promoted = 0
    graduated = 0
    copied = 0
    skipped = 0

    plan = []
    for e in src:
        if e.user_id in existing_uids:
            skipped += 1
            continue

        if e.role == "student":
            if not promote_students:
                skipped += 1
                continue
            new_grade = e.grade
            new_status = "active"
            if graduate_grade is not None and e.grade == graduate_grade:
                new_status = "graduated"
                graduated += 1
            else:
                new_grade = (e.grade or 0) + 1
                promoted += 1
            plan.append({
                "user_id": e.user_id,
                "role": "student",
                "from_grade": e.grade,
                "to_grade": new_grade if new_status == "active" else None,
                "status": new_status,
            })
            if not dry_run and new_status == "active":
                db.add(SemesterEnrollment(
                    semester_id=to_sid, user_id=e.user_id, role="student",
                    status="active",
                    grade=new_grade,
                    class_number=None,  # 반은 재배정 필요
                    student_number=None,
                ))
        elif e.role in ("teacher", "staff"):
            if not copy_teachers:
                skipped += 1
                continue
            copied += 1
            plan.append({
                "user_id": e.user_id,
                "role": e.role,
                "department": e.department,
            })
            if not dry_run:
                db.add(SemesterEnrollment(
                    semester_id=to_sid, user_id=e.user_id, role=e.role,
                    status="active",
                    department=e.department, position=e.position,
                    homeroom_class=None,  # 담임반은 재배정
                ))

    if not dry_run:
        await db.flush()
        await log_action(
            db, user, "enrollment.promote",
            f"from:{from_sid}->to:{to_sid} promoted={promoted} graduated={graduated} copied={copied}",
            request=request,
        )
        # 진급(학년 변경)·명단 복제 직후 대상 학기 기준 전체 드라이브 폴더 자동 동기화 (백그라운드)
        from app.services.folder_seed import sync_all_users_background
        background.add_task(sync_all_users_background, to_sid)

    return {
        "dry_run": dry_run,
        "promoted": promoted,
        "graduated": graduated,
        "copied_teachers": copied,
        "skipped": skipped,
        "plan_preview": plan[:50],  # 최대 50건 미리보기
        "total_plan_count": len(plan),
    }
