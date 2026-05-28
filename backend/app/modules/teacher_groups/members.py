"""참여 교사 (Member) — 부장이 초대/제외."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.teacher_group import TeacherGroup, TeacherGroupMember
from app.models.user import User
from app.modules.teacher_groups._helpers import assert_owner_or_admin
from app.modules.teacher_groups.router import router
from app.modules.teacher_groups.schemas import MemberAdd
from app.services.notification import notify_users


@router.post("/{gid}/_members")
async def add_member(
    gid: int,
    body: MemberAdd,
    user: User = Depends(require_permission("teacher_group.invite")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """참여 교사 초대 (owner/admin만)."""
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    await assert_owner_or_admin(g, user)
    teacher = await db.get(User, body.teacher_id)
    if not teacher or teacher.role not in ("teacher", "staff", "super_admin", "designated_admin"):
        raise HTTPException(400, "유효한 교사 ID가 아닙니다")

    existing = (await db.execute(
        select(TeacherGroupMember).where(
            TeacherGroupMember.group_id == gid,
            TeacherGroupMember.teacher_id == body.teacher_id,
        )
    )).scalar_one_or_none()
    if existing:
        return {"ok": True, "id": existing.id, "already": True}

    m = TeacherGroupMember(group_id=gid, teacher_id=body.teacher_id, role=body.role)
    db.add(m)
    await db.flush()
    await notify_users(
        db, user_ids=[body.teacher_id],
        type="teacher_group.invited",
        title=f"{g.name} 그룹에 초대되었습니다",
        body=g.description or None,
        link_url="/my-groups",
        source_user_id=user.id,
        meta={"group_id": gid, "group_name": g.name},
    )
    await log_action(db, user, "teacher_group.invite",
                     f"group={gid} teacher={body.teacher_id}", request=request)
    return {"ok": True, "id": m.id}


@router.delete("/{gid}/_members/{mid}")
async def remove_member(
    gid: int, mid: int,
    user: User = Depends(require_permission("teacher_group.invite")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    await assert_owner_or_admin(g, user)
    m = await db.get(TeacherGroupMember, mid)
    if not m or m.group_id != gid:
        raise HTTPException(404)
    await db.delete(m)
    await db.flush()
    return {"ok": True}
