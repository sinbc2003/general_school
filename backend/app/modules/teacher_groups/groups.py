"""그룹 CRUD."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.teacher_group import (
    TeacherGroup, TeacherGroupMember, TeacherGroupStudent,
)
from app.models.user import User
from app.modules.teacher_groups._helpers import (
    assert_owner_or_admin, group_to_dict, is_admin, is_department_lead,
)
from app.modules.teacher_groups.router import router
from app.modules.teacher_groups.schemas import GroupCreate, GroupUpdate


@router.get("")
async def list_groups(
    semester_id: int | None = None,
    type: str | None = None,
    mine: bool = False,
    user: User = Depends(require_permission("teacher_group.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(TeacherGroup)
    conds = []
    if semester_id:
        conds.append(TeacherGroup.semester_id == semester_id)
    if type:
        conds.append(TeacherGroup.type == type)
    if mine:
        member_group_ids = set(
            (await db.execute(
                select(TeacherGroupMember.group_id).where(TeacherGroupMember.teacher_id == user.id)
            )).scalars().all()
        )
        member_group_ids.add(-1)
        conds.append(or_(
            TeacherGroup.owner_id == user.id,
            TeacherGroup.id.in_(member_group_ids),
        ))
    if conds:
        q = q.where(and_(*conds))
    rows = (await db.execute(q.order_by(TeacherGroup.created_at.desc()))).scalars().all()
    return {"items": [group_to_dict(g) for g in rows]}


@router.post("")
async def create_group(
    body: GroupCreate,
    user: User = Depends(require_permission("teacher_group.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """그룹 생성. 부장교사 또는 admin만 가능."""
    if not (is_admin(user) or await is_department_lead(db, user)):
        raise HTTPException(403, "부장교사 또는 관리자만 그룹을 생성할 수 있습니다")
    g = TeacherGroup(
        semester_id=body.semester_id,
        name=body.name,
        type=body.type,
        description=body.description,
        owner_id=user.id,
    )
    db.add(g)
    await db.flush()
    await log_action(db, user, "teacher_group.create", f"id={g.id} name={body.name}", request=request)
    return {"id": g.id}


@router.get("/{gid}")
async def get_group(
    gid: int,
    user: User = Depends(require_permission("teacher_group.view")),
    db: AsyncSession = Depends(get_db),
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    members = (await db.execute(
        select(TeacherGroupMember, User).join(User, User.id == TeacherGroupMember.teacher_id)
        .where(TeacherGroupMember.group_id == gid)
    )).all()
    students = (await db.execute(
        select(TeacherGroupStudent, User).join(User, User.id == TeacherGroupStudent.student_id)
        .where(TeacherGroupStudent.group_id == gid)
    )).all()
    return {
        **group_to_dict(g, member_count=len(members), student_count=len(students)),
        "members": [
            {"id": m.id, "teacher_id": m.teacher_id, "teacher_name": u.name, "role": m.role}
            for m, u in members
        ],
        "students": [
            {
                "id": s.id,
                "student_id": s.student_id,
                "student_name": u.name,
                "student_username": u.username,
                "grade": u.grade,
                "assigned_teacher_id": s.assigned_teacher_id,
                "note": s.note,
            }
            for s, u in students
        ],
    }


@router.patch("/{gid}")
async def update_group(
    gid: int,
    body: GroupUpdate,
    user: User = Depends(require_permission("teacher_group.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    await assert_owner_or_admin(g, user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(g, k, v)
    await db.flush()
    await log_action(db, user, "teacher_group.update", f"id={gid}", request=request)
    return {"ok": True}


@router.delete("/{gid}")
async def delete_group(
    gid: int,
    user: User = Depends(require_permission("teacher_group.manage")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    await assert_owner_or_admin(g, user)
    await db.delete(g)
    await db.flush()
    await log_action(db, user, "teacher_group.delete", f"id={gid}", request=request)
    return {"ok": True}
