"""교사 임시 그룹 (행사·대회·연구 등) — CRUD + 멤버 + 학생 배정 + 산출물 승인."""

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import POLICY_CLASSROOM, validate_upload
from app.models.department import Department
from app.models.teacher_group import (
    GroupSubmission,
    TeacherGroup,
    TeacherGroupMember,
    TeacherGroupStudent,
)
from app.models.user import User
from app.modules.teacher_groups.schemas import (
    GroupCreate,
    GroupUpdate,
    MemberAdd,
    StudentAssign,
    StudentAssignByUsername,
    SubmissionReviewReq,
)
from app.services.notification import notify_users
from app.services.student_artifact_sync import ensure_student_artifact

router = APIRouter(prefix="/api/teacher-groups", tags=["teacher-groups"])

UPLOAD_DIR = os.path.join("storage", "group_submissions")


def _is_admin(u: User) -> bool:
    return u.role in ("super_admin", "designated_admin")


async def _is_department_lead(db: AsyncSession, u: User) -> bool:
    """부장교사: Department.lead_user_id 매칭."""
    if not u.department_id:
        return False
    dep = await db.get(Department, u.department_id)
    return bool(dep and dep.lead_user_id == u.id)


async def _assert_group_owner_or_admin(db: AsyncSession, group: TeacherGroup, u: User):
    if _is_admin(u) or group.owner_id == u.id:
        return
    raise HTTPException(403, "그룹 owner/admin만 가능합니다")


async def _is_group_member(db: AsyncSession, group_id: int, user_id: int) -> bool:
    row = (await db.execute(
        select(TeacherGroupMember).where(
            TeacherGroupMember.group_id == group_id,
            TeacherGroupMember.teacher_id == user_id,
        )
    )).scalar_one_or_none()
    return row is not None


def _group_to_dict(g: TeacherGroup, member_count: int = 0, student_count: int = 0) -> dict:
    return {
        "id": g.id,
        "semester_id": g.semester_id,
        "name": g.name,
        "type": g.type,
        "description": g.description,
        "owner_id": g.owner_id,
        "is_active": g.is_active,
        "member_count": member_count,
        "student_count": student_count,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }


# ── 그룹 CRUD ─────────────────────────────────────────


@router.get("")
async def list_groups(
    semester_id: int | None = None,
    type: str | None = None,
    mine: bool = False,
    user: User = Depends(require_permission("teacher_group.view")),
    db: AsyncSession = Depends(get_db),
):
    """그룹 목록.

    mine=true: 내가 owner이거나 멤버인 그룹만.
    그 외: semester/type 필터 OK.
    """
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
        member_group_ids.add(-1)  # 빈 set 방지
        conds.append(or_(
            TeacherGroup.owner_id == user.id,
            TeacherGroup.id.in_(member_group_ids),
        ))
    if conds:
        q = q.where(and_(*conds))
    rows = (await db.execute(q.order_by(TeacherGroup.created_at.desc()))).scalars().all()
    return {"items": [_group_to_dict(g) for g in rows]}


@router.post("")
async def create_group(
    body: GroupCreate,
    user: User = Depends(require_permission("teacher_group.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """그룹 생성. 부장교사 또는 admin만 가능."""
    if not (_is_admin(user) or await _is_department_lead(db, user)):
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
        **_group_to_dict(g, member_count=len(members), student_count=len(students)),
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
    await _assert_group_owner_or_admin(db, g, user)
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
    await _assert_group_owner_or_admin(db, g, user)
    await db.delete(g)
    await db.flush()
    await log_action(db, user, "teacher_group.delete", f"id={gid}", request=request)
    return {"ok": True}


# ── 참여 교사 (Member) ───────────────────────────────


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
    await _assert_group_owner_or_admin(db, g, user)
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
    # 초대 알림
    await notify_users(
        db, user_ids=[body.teacher_id],
        type="teacher_group.invited",
        title=f"{g.name} 그룹에 초대되었습니다",
        body=g.description or None,
        link_url=f"/my-groups",
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
    await _assert_group_owner_or_admin(db, g, user)
    m = await db.get(TeacherGroupMember, mid)
    if not m or m.group_id != gid:
        raise HTTPException(404)
    await db.delete(m)
    await db.flush()
    return {"ok": True}


# ── 학생 배정 (참여 교사가 본인 책임으로) ────────────


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
    """학생 배정. 참여 교사 본인이 등록한 학생은 본인이 담당.

    student_id 또는 username 중 하나 사용 가능 (학번 검색 흐름 지원).
    """
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    # 그룹 멤버이거나 owner/admin이어야 함
    if not (_is_admin(user) or g.owner_id == user.id or await _is_group_member(db, gid, user.id)):
        raise HTTPException(403, "그룹 참여 교사만 학생을 배정할 수 있습니다")

    student: User | None = None
    if isinstance(body, StudentAssignByUsername) or "username" in (body.model_dump() if hasattr(body, "model_dump") else {}):
        username = getattr(body, "username", None)
        if username:
            student = (await db.execute(
                select(User).where(User.username == username, User.role == "student")
            )).scalar_one_or_none()
    if not student:
        sid = getattr(body, "student_id", None)
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
        if existing.assigned_teacher_id != user.id and not _is_admin(user):
            raise HTTPException(409, "다른 교사가 이미 담당 중입니다")
        existing.note = getattr(body, "note", None) or existing.note
        existing.assigned_teacher_id = user.id
        await db.flush()
        return {"ok": True, "id": existing.id, "already": True}

    s = TeacherGroupStudent(
        group_id=gid,
        student_id=student.id,
        assigned_teacher_id=user.id,
        note=getattr(body, "note", None),
    )
    db.add(s)
    await db.flush()

    # 학생에게 알림
    await notify_users(
        db, user_ids=[student.id],
        type="teacher_group.student_assigned",
        title=f"'{g.name}' 활동에 등록되었습니다",
        body=f"담당 교사: {user.name}",
        link_url=f"/s/my-activities",
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
    if s.assigned_teacher_id != user.id and not _is_admin(user) and g.owner_id != user.id:
        raise HTTPException(403)
    await db.delete(s)
    await db.flush()
    return {"ok": True}


# ── 학생 산출물 (Submission) ─────────────────────────


@router.post("/{gid}/_submissions")
async def submit_to_group(
    gid: int,
    file: UploadFile = File(...),
    title: str = Form(..., min_length=1),
    description: str | None = Form(None),
    user: User = Depends(require_permission("teacher_group.submit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학생이 본인이 속한 그룹에 산출물 제출."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용")
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    assignment = (await db.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == gid,
            TeacherGroupStudent.student_id == user.id,
        )
    )).scalar_one_or_none()
    if not assignment:
        raise HTTPException(403, "본인이 등록되지 않은 그룹입니다")

    data = await validate_upload(file, POLICY_CLASSROOM)
    await ensure_dir_async(Path(UPLOAD_DIR))
    ext = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{ext}")
    await write_bytes_async(Path(stored_path), data)

    sub = GroupSubmission(
        group_id=gid,
        student_id=user.id,
        title=title.strip(),
        description=description,
        file_url="/" + stored_path.replace("\\", "/"),
        file_name=file.filename or stored_path,
        file_size=len(data),
        status="pending",
    )
    db.add(sub)
    await db.flush()

    # 담당교사에게 알림
    await notify_users(
        db, user_ids=[assignment.assigned_teacher_id],
        type="group_submission.submitted",
        title=f"{user.name} 학생이 '{g.name}' 산출물을 제출했습니다",
        body=title[:200],
        link_url="/research-review",
        source_user_id=user.id,
        meta={"group_id": gid, "submission_id": sub.id},
    )
    await log_action(db, user, "teacher_group.submit",
                     f"group={gid} sub={sub.id}", request=request)
    return {"id": sub.id, "status": sub.status}


@router.get("/{gid}/_submissions")
async def list_group_submissions(
    gid: int,
    user: User = Depends(require_permission("teacher_group.view")),
    db: AsyncSession = Depends(get_db),
):
    g = await db.get(TeacherGroup, gid)
    if not g:
        raise HTTPException(404)
    rows = (await db.execute(
        select(GroupSubmission, User).join(User, User.id == GroupSubmission.student_id)
        .where(GroupSubmission.group_id == gid)
        .order_by(GroupSubmission.created_at.desc())
    )).all()
    return {
        "items": [
            {
                "id": s.id, "group_id": s.group_id,
                "student_id": s.student_id, "student_name": u.name, "student_username": u.username,
                "title": s.title, "description": s.description,
                "file_url": s.file_url, "file_name": s.file_name, "file_size": s.file_size,
                "status": s.status, "reviewed_by_id": s.reviewed_by_id,
                "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
                "rejection_reason": s.rejection_reason,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, u in rows
        ],
    }


@router.patch("/_submissions/{sid}/_review")
async def review_group_submission(
    sid: int,
    body: SubmissionReviewReq,
    user: User = Depends(require_permission("teacher_group.review")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sub = await db.get(GroupSubmission, sid)
    if not sub:
        raise HTTPException(404)
    if sub.status != "pending":
        raise HTTPException(409, f"이미 처리됨 (status={sub.status})")

    # 본인이 학생의 assigned_teacher인지 확인
    assignment = (await db.execute(
        select(TeacherGroupStudent).where(
            TeacherGroupStudent.group_id == sub.group_id,
            TeacherGroupStudent.student_id == sub.student_id,
        )
    )).scalar_one_or_none()
    if not _is_admin(user) and (not assignment or assignment.assigned_teacher_id != user.id):
        raise HTTPException(403, "담당 교사만 승인할 수 있습니다")

    sub.status = body.status
    sub.reviewed_by_id = user.id
    sub.reviewed_at = datetime.now(timezone.utc)
    sub.rejection_reason = body.rejection_reason if body.status == "rejected" else None

    if body.status == "approved":
        g = await db.get(TeacherGroup, sub.group_id)
        artifact_id = await ensure_student_artifact(
            db,
            student_id=sub.student_id,
            title=sub.title,
            description=f"{g.name if g else '그룹'} 산출물",
            category="report",
            file_url=sub.file_url,
            file_name=sub.file_name,
            file_size=sub.file_size,
            tags=[g.name] if g else [],
            existing_id=sub.student_artifact_id,
        )
        if artifact_id:
            sub.student_artifact_id = artifact_id

    await db.flush()

    # 학생 알림
    if body.status == "approved":
        await notify_users(
            db, user_ids=[sub.student_id],
            type="group_submission.approved",
            title="그룹 산출물이 승인되었습니다",
            body=sub.title,
            link_url="/s/my-portfolio",
            source_user_id=user.id,
            meta={"submission_id": sub.id},
        )
    else:
        await notify_users(
            db, user_ids=[sub.student_id],
            type="group_submission.rejected",
            title="그룹 산출물이 반려되었습니다",
            body=body.rejection_reason or "사유 미기재",
            link_url="/s/my-activities",
            source_user_id=user.id,
            meta={"submission_id": sub.id, "reason": body.rejection_reason},
        )

    await log_action(
        db, user, f"group_submission.{body.status}", f"id={sid}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "status": sub.status}


@router.get("/_my/pending")
async def my_pending_group_submissions(
    user: User = Depends(require_permission("teacher_group.review")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 담당 교사인 학생들의 pending 그룹 산출물."""
    # 본인이 assigned_teacher인 (group_id, student_id) 쌍 조회
    rows = (await db.execute(
        select(GroupSubmission, User, TeacherGroup).join(
            User, User.id == GroupSubmission.student_id,
        ).join(
            TeacherGroup, TeacherGroup.id == GroupSubmission.group_id,
        ).join(
            TeacherGroupStudent, and_(
                TeacherGroupStudent.group_id == GroupSubmission.group_id,
                TeacherGroupStudent.student_id == GroupSubmission.student_id,
            ),
        ).where(
            GroupSubmission.status == "pending",
            TeacherGroupStudent.assigned_teacher_id == user.id,
        ).order_by(GroupSubmission.created_at.desc())
    )).all()
    return {
        "items": [
            {
                "id": s.id, "group_id": s.group_id, "group_name": g.name,
                "student_id": s.student_id, "student_name": u.name, "student_username": u.username,
                "title": s.title, "description": s.description,
                "file_url": s.file_url, "file_name": s.file_name, "file_size": s.file_size,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, u, g in rows
        ],
    }


@router.get("/_my/student-activities")
async def my_activities(
    user: User = Depends(require_permission("teacher_group.submit")),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 속한 모든 그룹 + 본인 산출물 list."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용")
    assignments = (await db.execute(
        select(TeacherGroupStudent, TeacherGroup, User).join(
            TeacherGroup, TeacherGroup.id == TeacherGroupStudent.group_id,
        ).join(
            User, User.id == TeacherGroupStudent.assigned_teacher_id,
        ).where(TeacherGroupStudent.student_id == user.id)
    )).all()

    group_ids = [a.group_id for a, _, _ in assignments]
    subs_by_group: dict[int, list] = {}
    if group_ids:
        all_subs = (await db.execute(
            select(GroupSubmission).where(
                GroupSubmission.group_id.in_(group_ids),
                GroupSubmission.student_id == user.id,
            )
        )).scalars().all()
        for s in all_subs:
            subs_by_group.setdefault(s.group_id, []).append({
                "id": s.id, "title": s.title, "status": s.status,
                "file_url": s.file_url, "file_name": s.file_name,
                "rejection_reason": s.rejection_reason,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            })

    return {
        "items": [
            {
                "group_id": g.id, "group_name": g.name, "type": g.type,
                "description": g.description,
                "teacher_id": t.id, "teacher_name": t.name,
                "submissions": subs_by_group.get(g.id, []),
            }
            for a, g, t in assignments
        ],
    }


