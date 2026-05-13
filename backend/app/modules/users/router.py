"""사용자 관리 라우터 — CRUD + 엑셀 일괄 등록"""

import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import hash_password, get_current_user
from app.core.permissions import require_permission, require_permission_manager
from app.core.audit import log_action
from app.models.user import User
from app.modules.users.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    BulkValidationResult,
    BulkImportResult,
)
from app.services.excel_service import (
    generate_user_template,
    parse_user_excel,
    generate_user_export,
)

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {"super_admin", "designated_admin", "teacher", "staff", "student"}


def _user_response(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "username": u.username,
        "role": u.role,
        "status": u.status,
        "grade": u.grade,
        "class_number": u.class_number,
        "student_number": u.student_number,
        "department": u.department,
        "totp_enabled": u.totp_enabled,
        "must_change_password": u.must_change_password,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


@router.get("")
async def list_users(
    role: str | None = None,
    grade: int | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 50,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    query = select(User)

    if role:
        query = query.where(User.role == role)
    if grade is not None:
        query = query.where(User.grade == grade)
    if status:
        query = query.where(User.status == status)
    if search:
        query = query.where(
            (User.name.ilike(f"%{search}%")) | (User.email.ilike(f"%{search}%"))
        )

    # 지정관리자는 자신보다 하위 역할만 조회
    if user.role == "designated_admin":
        query = query.where(User.role.in_(["teacher", "staff", "student"]))

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(User.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "items": [_user_response(u) for u in users],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("")
async def create_user(
    body: UserCreate,
    request: Request,
    user: User = Depends(require_permission("user.manage.create")),
    db: AsyncSession = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"유효하지 않은 역할: {body.role}")

    # 지정관리자는 super_admin/designated_admin 생성 불가
    if user.role == "designated_admin" and body.role in ("super_admin", "designated_admin"):
        raise HTTPException(403, "상위 역할의 사용자를 생성할 수 없습니다")

    # 이메일 중복 체크
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "이미 등록된 이메일입니다")

    password = body.password or settings.DEFAULT_USER_PASSWORD

    new_user = User(
        email=body.email,
        name=body.name,
        username=body.username,
        password_hash=hash_password(password),
        role=body.role,
        status="approved",
        grade=body.grade,
        class_number=body.class_number,
        student_number=body.student_number,
        department=body.department,
        must_change_password=True,
    )
    db.add(new_user)
    await db.flush()

    await log_action(db, user, "user_created", target=body.email, request=request)
    return _user_response(new_user)


@router.put("/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    # 지정관리자는 상위 역할 수정 불가
    if user.role == "designated_admin" and target.role in ("super_admin", "designated_admin"):
        raise HTTPException(403, "상위 역할의 사용자를 수정할 수 없습니다")

    if body.name is not None:
        target.name = body.name
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(400, f"유효하지 않은 역할: {body.role}")
        if user.role == "designated_admin" and body.role in ("super_admin", "designated_admin"):
            raise HTTPException(403, "상위 역할로 변경할 수 없습니다")
        target.role = body.role
    if body.status is not None:
        target.status = body.status
    if body.grade is not None:
        target.grade = body.grade
    if body.class_number is not None:
        target.class_number = body.class_number
    if body.student_number is not None:
        target.student_number = body.student_number
    if body.department is not None:
        target.department = body.department

    await db.flush()
    await log_action(db, user, "user_updated", target=target.email, request=request)
    return _user_response(target)


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    user: User = Depends(require_permission("user.manage.delete")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.role == "super_admin":
        raise HTTPException(403, "최고관리자는 삭제할 수 없습니다")

    target.status = "disabled"
    await db.flush()
    await log_action(db, user, "user_disabled", target=target.email, request=request)
    return {"ok": True}


@router.post("/{user_id}/reset-password")
async def reset_password(
    user_id: int,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404)

    target.password_hash = hash_password(settings.DEFAULT_USER_PASSWORD)
    target.must_change_password = True
    await db.flush()
    await log_action(db, user, "password_reset", target=target.email, request=request)
    return {"ok": True, "default_password": settings.DEFAULT_USER_PASSWORD}


# ── 엑셀 ──
@router.get("/excel-template")
async def download_excel_template(
    user: User = Depends(require_permission("user.manage.bulk_import")),
):
    buf = generate_user_template()
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=user_import_template.xlsx"},
    )


@router.post("/bulk-import/validate")
async def validate_bulk_import(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("user.manage.bulk_import")),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, ".xlsx 파일만 지원합니다")

    content = await file.read()
    rows, errors = await parse_user_excel(content, db)

    preview = rows[:10] if rows else []
    return BulkValidationResult(
        valid_count=len(rows),
        error_count=len(errors),
        errors=errors,
        preview=preview,
    )


@router.post("/bulk-import/confirm")
async def confirm_bulk_import(
    file: UploadFile = File(...),
    request: Request = None,
    user: User = Depends(require_permission("user.manage.bulk_import")),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(400, ".xlsx 파일만 지원합니다")

    content = await file.read()
    rows, errors = await parse_user_excel(content, db)

    created = 0
    for row in rows:
        password = row.get("password") or settings.DEFAULT_USER_PASSWORD
        new_user = User(
            email=row["email"],
            name=row["name"],
            password_hash=hash_password(password),
            role=row["role"],
            status="approved",
            grade=row.get("grade"),
            class_number=row.get("class_number"),
            student_number=row.get("student_number"),
            department=row.get("department"),
            must_change_password=True,
        )
        db.add(new_user)
        created += 1

    await db.flush()
    await log_action(
        db, user, "bulk_import",
        detail=f"{created}명 등록",
        request=request,
    )
    return BulkImportResult(created=created, skipped=len(errors))


@router.post("/bulk-export")
async def export_users(
    role: str | None = None,
    grade: int | None = None,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    query = select(User)
    if role:
        query = query.where(User.role == role)
    if grade is not None:
        query = query.where(User.grade == grade)
    query = query.order_by(User.role, User.grade, User.class_number, User.student_number)

    result = await db.execute(query)
    users = result.scalars().all()

    buf = generate_user_export(users)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=user_export.xlsx"},
    )


# ── 학년 진급 / 졸업 처리 (누적 운영 핵심) ──
# 경로에 "_cohort" 접두를 둬서 /{user_id} 와 충돌 회피

@router.post("/_cohort/promote")
async def promote_students(
    body: dict, request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """학년 일괄 진급
    body: {from_grade: 1, to_grade: 2, dry_run: false}
    학년 = 1, 2, 3 외 → 무시. dry_run=true는 영향받는 학생 수만 반환.
    """
    from_grade = body.get("from_grade")
    to_grade = body.get("to_grade")
    dry_run = bool(body.get("dry_run", False))
    if from_grade not in (1, 2) or to_grade != from_grade + 1:
        raise HTTPException(400, "from_grade는 1 또는 2, to_grade는 from_grade+1이어야 합니다 (3학년 진급은 졸업 처리 사용)")

    targets = (await db.execute(
        select(User).where(User.role == "student", User.grade == from_grade, User.status == "approved")
    )).scalars().all()

    if dry_run:
        return {"affected": len(targets), "dry_run": True}

    for u in targets:
        u.grade = to_grade
    await db.flush()
    await log_action(db, user, "student.promote", f"from_grade={from_grade} count={len(targets)}", request=request)
    return {"affected": len(targets), "dry_run": False}


@router.post("/_cohort/graduate")
async def graduate_students(
    body: dict, request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """졸업 처리
    body: {graduation_year: 2026, ids?: [int], from_grade?: 3, dry_run?: false}
    ids 우선, 없으면 from_grade(기본 3)의 모든 재학생.
    User.status = "graduated"로 변경. 데이터는 모두 보존.
    """
    grad_year = body.get("graduation_year")
    if not grad_year:
        raise HTTPException(400, "graduation_year 필수")
    ids = body.get("ids")
    from_grade = body.get("from_grade", 3)
    dry_run = bool(body.get("dry_run", False))

    q = select(User).where(User.role == "student", User.status == "approved")
    if ids:
        q = q.where(User.id.in_(ids))
    else:
        q = q.where(User.grade == from_grade)
    targets = (await db.execute(q)).scalars().all()

    if dry_run:
        return {"affected": len(targets), "dry_run": True,
                "preview_names": [u.name for u in targets[:20]]}

    for u in targets:
        u.status = "graduated"
        # graduation_year를 어딘가 기록 — User에 컬럼이 없으니 admissions.AdmissionsRecord에 의존하거나 그냥 status만 변경
    await db.flush()
    await log_action(db, user, "student.graduate", f"year={grad_year} count={len(targets)}", request=request)
    return {"affected": len(targets), "dry_run": False, "graduation_year": grad_year}


@router.get("/_cohort/graduates")
async def list_graduates(
    graduation_year: int | None = None,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    """졸업생 목록. graduation_year는 AdmissionsRecord.graduation_year 매칭 시도."""
    q = select(User).where(User.role == "student", User.status == "graduated").order_by(User.name)
    rows = (await db.execute(q)).scalars().all()

    # AdmissionsRecord 매핑
    from app.models.admissions import AdmissionsRecord
    ar_map: dict = {}
    if rows:
        ar_q = select(AdmissionsRecord).where(AdmissionsRecord.student_id.in_([u.id for u in rows]))
        if graduation_year:
            ar_q = ar_q.where(AdmissionsRecord.graduation_year == graduation_year)
        for ar in (await db.execute(ar_q)).scalars().all():
            ar_map[ar.student_id] = ar

    items = []
    for u in rows:
        ar = ar_map.get(u.id)
        if graduation_year and not ar:
            continue
        items.append({
            "id": u.id, "name": u.name, "email": u.email,
            "graduation_year": ar.graduation_year if ar else None,
            "results": ar.results if ar else None,
        })
    return {"items": items}
