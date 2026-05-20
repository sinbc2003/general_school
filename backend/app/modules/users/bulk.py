"""사용자 일괄 import/export endpoints.

- Excel 양식 다운로드 + bulk-import validate/confirm + export
- CSV 역할별 템플릿 다운로드 + 일괄 등록 (super_admin 전용)

router 객체는 router.py에서 공유. router.py 끝의 'from . import bulk'로 등록.
"""

from fastapi import Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import hash_password
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission, require_super_admin
from app.models.user import User
from app.modules.users.schemas import BulkImportResult, BulkValidationResult
from app.services.excel_service import (
    generate_user_export, generate_user_template, parse_user_excel,
)
from app.services.user_csv_io import (
    CSV_TEMPLATES as USER_CSV_TEMPLATES,
    import_users_csv,
    template_csv as user_template_csv,
)

from app.modules.users.router import router


# ── Excel 양식 + 일괄 등록/검증/export ──

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
    from app.core.upload import validate_upload, POLICY_CSV
    content = await validate_upload(file, POLICY_CSV)
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
    import asyncio

    from app.core.upload import validate_upload, POLICY_CSV
    content = await validate_upload(file, POLICY_CSV)
    rows, errors = await parse_user_excel(content, db)

    # 비밀번호 해싱은 PBKDF2/bcrypt — 1행당 50~200ms CPU-bound.
    # 1000명이면 sync 루프로 100초 차단. 한 번에 to_thread로 위임.
    passwords = [row.get("password") or settings.DEFAULT_USER_PASSWORD for row in rows]
    hashes = await asyncio.to_thread(lambda: [hash_password(p) for p in passwords])

    created = 0
    for row, pwd_hash in zip(rows, hashes):
        new_user = User(
            email=row["email"],
            name=row["name"],
            password_hash=pwd_hash,
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


# ── CSV 일괄 등록 (역할별, super_admin 전용) ──
# /_csv 접두로 /{user_id} 충돌 회피

@router.get("/_csv/template/{role}")
async def download_user_csv_template(
    role: str,
    user: User = Depends(require_super_admin()),
):
    """역할별 CSV 템플릿 다운로드 (최고관리자 전용)"""
    if role not in USER_CSV_TEMPLATES:
        raise HTTPException(400, f"valid roles: {list(USER_CSV_TEMPLATES.keys())}")
    content = user_template_csv(role)
    return Response(
        content=content, media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="users_{role}_template.csv"'},
    )


@router.post("/_csv/import/{role}")
async def import_users_from_csv(
    role: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    request: Request = None,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """CSV 일괄 등록 (최고관리자 전용).
    role: designated_admin | teacher | student
    dry_run=true → 검증만 (DB 변경 없음)
    """
    if role not in USER_CSV_TEMPLATES:
        raise HTTPException(400, f"valid roles: {list(USER_CSV_TEMPLATES.keys())}")
    raw = await file.read()
    result = await import_users_csv(db, role, raw, granted_by_user_id=user.id, dry_run=dry_run)
    if not dry_run:
        await log_action(
            db, user, f"users.csv_import.{role}",
            target=f"ok={result['ok_count']}, errors={len(result['errors'])}",
            request=request,
        )
    return result
