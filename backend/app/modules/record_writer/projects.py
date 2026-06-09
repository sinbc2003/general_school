"""생기부 프로젝트 CRUD + 범위→학생 자동 행."""

from datetime import datetime, timezone

from fastapi import Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.models.student_record_project import RecordProject, RecordProjectStudent
from app.models.user import User
from app.modules.record_writer._helpers import (
    get_owned_project,
    is_admin,
    project_to_dict,
    resolve_scope_students,
)
from app.modules.record_writer.router import router
from app.modules.record_writer.schemas import (
    AddStudentsReq,
    RecordProjectCreate,
    RecordProjectUpdate,
)


@router.post("/projects")
async def create_project(
    body: RecordProjectCreate,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    semester_id = await get_active_semester_id_or_404(db)
    student_ids = await resolve_scope_students(
        db,
        user,
        scope_type=body.scope_type,
        scope_ref_id=body.scope_ref_id,
        scope_ref_class=body.scope_ref_class,
        semester_id=semester_id,
    )
    p = RecordProject(
        owner_id=user.id,
        semester_id=semester_id,
        name=body.name,
        scope_type=body.scope_type,
        scope_ref_id=body.scope_ref_id,
        scope_ref_class=body.scope_ref_class,
        global_prompt=body.global_prompt,
    )
    db.add(p)
    await db.flush()
    for i, sid in enumerate(student_ids):
        db.add(RecordProjectStudent(project_id=p.id, student_id=sid, display_order=i))
    # 생기부 종류 템플릿 — 기본 항목 자동 생성
    if body.template_id:
        from app.models.student_record_project import RecordColumn
        from app.modules.record_writer.presets import RECORD_PRESETS

        preset = RECORD_PRESETS.get(body.template_id)
        if preset:
            for ci, cdef in enumerate(preset["columns"]):
                db.add(
                    RecordColumn(
                        project_id=p.id,
                        name=cdef["name"],
                        display_order=ci,
                        system_prompt=cdef.get("system_prompt"),
                        source_config=cdef.get("source_config"),
                        char_max=cdef.get("char_max"),
                        kind=cdef.get("kind", "normal"),
                    )
                )
    await log_action(
        db, user, "record.project.create",
        detail=f"생기부 프로젝트 '{body.name}' 생성 (범위={body.scope_type}, 학생 {len(student_ids)}명)",
        is_sensitive=True,
    )
    await db.commit()
    await db.refresh(p)
    return {**project_to_dict(p), "student_count": len(student_ids)}


@router.get("/projects")
async def list_projects(
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(RecordProject).where(RecordProject.deleted_at.is_(None))
    if not is_admin(user):
        q = q.where(RecordProject.owner_id == user.id)
    q = q.order_by(RecordProject.updated_at.desc())
    projects = (await db.execute(q)).scalars().all()

    # 프로젝트별 학생 수 (batch)
    counts: dict[int, int] = {}
    if projects:
        rows = (
            await db.execute(
                select(
                    RecordProjectStudent.project_id,
                    func.count(RecordProjectStudent.id),
                )
                .where(RecordProjectStudent.project_id.in_([p.id for p in projects]))
                .group_by(RecordProjectStudent.project_id)
            )
        ).all()
        counts = {pid: cnt for pid, cnt in rows}
    return [
        {**project_to_dict(p), "student_count": counts.get(p.id, 0)}
        for p in projects
    ]


@router.get("/projects/{pid}")
async def get_project(
    pid: int,
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    p = await get_owned_project(db, user, pid)
    rows = (
        await db.execute(
            select(RecordProjectStudent, User.name)
            .join(User, User.id == RecordProjectStudent.student_id)
            .where(RecordProjectStudent.project_id == pid)
            .order_by(RecordProjectStudent.display_order)
        )
    ).all()
    students = [
        {
            "id": rps.id,
            "student_id": rps.student_id,
            "name": name,
            "display_order": rps.display_order,
            "is_published": rps.is_published,
            "final_text": rps.final_text,
        }
        for rps, name in rows
    ]
    return {**project_to_dict(p), "students": students}


@router.put("/projects/{pid}")
async def update_project(
    pid: int,
    body: RecordProjectUpdate,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = await get_owned_project(db, user, pid)
    if body.name is not None:
        p.name = body.name
    if body.global_prompt is not None:
        p.global_prompt = body.global_prompt
    await db.commit()
    await db.refresh(p)
    return project_to_dict(p)


@router.delete("/projects/{pid}")
async def delete_project(
    pid: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = await get_owned_project(db, user, pid)
    p.deleted_at = datetime.now(timezone.utc)
    p.deleted_by = user.id
    await log_action(
        db, user, "record.project.delete",
        detail=f"생기부 프로젝트 #{pid} 삭제", is_sensitive=True,
    )
    await db.commit()
    return {"ok": True}


@router.post("/projects/{pid}/refresh-students")
async def refresh_students(
    pid: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """범위에서 학생을 재동기화 — 신규 학생만 추가 (수동 추가/기존 보존)."""
    p = await get_owned_project(db, user, pid)
    student_ids = await resolve_scope_students(
        db,
        user,
        scope_type=p.scope_type,
        scope_ref_id=p.scope_ref_id,
        scope_ref_class=p.scope_ref_class,
        semester_id=p.semester_id,
    )
    existing = set(
        (
            await db.execute(
                select(RecordProjectStudent.student_id).where(
                    RecordProjectStudent.project_id == pid
                )
            )
        ).scalars().all()
    )
    max_order = (
        await db.execute(
            select(func.max(RecordProjectStudent.display_order)).where(
                RecordProjectStudent.project_id == pid
            )
        )
    ).scalar() or 0
    added = 0
    for sid in student_ids:
        if sid not in existing:
            max_order += 1
            db.add(
                RecordProjectStudent(
                    project_id=pid, student_id=sid, display_order=max_order
                )
            )
            added += 1
    await db.commit()
    return {"added": added, "total": len(existing) + added}


@router.post("/projects/{pid}/students")
async def add_students_manual(
    pid: int,
    body: AddStudentsReq,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학생 수동 추가 (manual scope 또는 범위 외 학생 가감)."""
    p = await get_owned_project(db, user, pid)
    existing = set(
        (
            await db.execute(
                select(RecordProjectStudent.student_id).where(
                    RecordProjectStudent.project_id == pid
                )
            )
        ).scalars().all()
    )
    max_order = (
        await db.execute(
            select(func.max(RecordProjectStudent.display_order)).where(
                RecordProjectStudent.project_id == pid
            )
        )
    ).scalar() or 0
    added = 0
    for sid in body.student_ids:
        if sid not in existing:
            max_order += 1
            db.add(
                RecordProjectStudent(
                    project_id=pid, student_id=sid, display_order=max_order
                )
            )
            existing.add(sid)
            added += 1
    await db.commit()
    return {"added": added}


@router.delete("/projects/{pid}/students/{student_id}")
async def remove_student(
    pid: int,
    student_id: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """학생 행 제거 (셀도 cascade 정리)."""
    p = await get_owned_project(db, user, pid)
    row = (
        await db.execute(
            select(RecordProjectStudent).where(
                RecordProjectStudent.project_id == pid,
                RecordProjectStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if row:
        await db.delete(row)
        # 이 학생의 셀도 제거
        from app.models.student_record_project import RecordCell

        cells = (
            await db.execute(
                select(RecordCell).where(
                    RecordCell.project_id == pid,
                    RecordCell.student_id == student_id,
                )
            )
        ).scalars().all()
        for cell in cells:
            await db.delete(cell)
        await db.commit()
    return {"ok": True}
