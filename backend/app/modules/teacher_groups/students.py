"""학생 배정 — 참여 교사가 본인 책임으로 등록."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.teacher_group import TeacherGroup, TeacherGroupStudent
from app.models.user import User
from app.modules.teacher_groups._helpers import is_admin, is_group_member
from app.modules.teacher_groups.router import router
from app.modules.teacher_groups.schemas import StudentAssign, StudentAssignByUsername
from app.services.notification import notify_users


@router.get("/_students/_search")
async def search_student(
    q: str,
    user: User = Depends(require_permission("teacher_group.assign_student")),
    db: AsyncSession = Depends(get_db),
):
    """학번(username) 또는 이름으로 학생 검색."""
    if not q or len(q.strip()) < 1:
        return {"items": []}
    kw = f"%{q.strip()}%"
    rows = (await db.execute(
        select(User).where(
            User.role == "student",
            or_(User.username.ilike(kw), User.name.ilike(kw)),
        ).limit(20)
    )).scalars().all()
    return {
        "items": [
            {"id": u.id, "username": u.username, "name": u.name, "grade": u.grade,
             "class_number": getattr(u, "class_number", None)}
            for u in rows
        ],
    }


@router.post("/{gid}/_students")
async def assign_student(
    gid: int,
    body: StudentAssign | StudentAssignByUsername,
    user: User = Depends(require_permission("teacher_group.assign_student")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학생 배정. 참여 교사 본인이 등록 → 본인이 담당."""
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    if not (is_admin(user) or g.owner_id == user.id or await is_group_member(db, gid, user.id)):
        raise HTTPException(403, "그룹 참여 교사만 학생을 배정할 수 있습니다")

    student: User | None = None
    body_dict = body.model_dump() if hasattr(body, "model_dump") else {}
    username = body_dict.get("username")
    if username:
        student = (await db.execute(
            select(User).where(User.username == username, User.role == "student")
        )).scalar_one_or_none()
    if not student:
        sid = body_dict.get("student_id")
        if sid:
            student = await db.get(User, sid)
    if not student or student.role != "student":
        raise HTTPException(400, "학생을 찾을 수 없습니다")

    existing = (await db.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == gid,
            TeacherGroupStudent.student_id == student.id,
        )
    )).scalar_one_or_none()
    if existing:
        if existing.assigned_teacher_id != user.id and not is_admin(user):
            raise HTTPException(409, "다른 교사가 이미 담당 중입니다")
        existing.note = body_dict.get("note") or existing.note
        existing.assigned_teacher_id = user.id
        await db.flush()
        return {"ok": True, "id": existing.id, "already": True}

    s = TeacherGroupStudent(
        group_id=gid,
        student_id=student.id,
        assigned_teacher_id=user.id,
        note=body_dict.get("note"),
    )
    db.add(s)
    await db.flush()

    await notify_users(
        db, user_ids=[student.id],
        type="teacher_group.student_assigned",
        title=f"'{g.name}' 활동에 등록되었습니다",
        body=f"담당 교사: {user.name}",
        link_url="/s/my-activities",
        source_user_id=user.id,
        meta={"group_id": gid, "group_name": g.name},
    )
    await log_action(db, user, "teacher_group.assign_student",
                     f"group={gid} student={student.id}", request=request)
    return {"ok": True, "id": s.id}


@router.delete("/{gid}/_students/{sid}")
async def unassign_student(
    gid: int, sid: int,
    user: User = Depends(require_permission("teacher_group.assign_student")),
    db: AsyncSession = Depends(get_db),
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    s = await db.get(TeacherGroupStudent, sid)
    if not s or s.group_id != gid:
        raise HTTPException(404)
    if s.assigned_teacher_id != user.id and not is_admin(user) and g.owner_id != user.id:
        raise HTTPException(403)
    await db.delete(s)
    await db.flush()
    return {"ok": True}
