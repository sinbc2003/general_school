"""HWP 문서 — CRUD + 업로드/다운로드 + 멤버.

설계:
  - 협업 미지원 (rhwp v2 로드맵). 한 명이 편집·저장 → 다른 사람 refresh 후 최신.
  - 동시 편집 시 마지막 저장 우선 (LWW).
  - 파일은 storage/hwps/{id}/<uuid>.{hwp|hwpx}.
  - files/router.py의 _guard_classroom 확장으로 인증된 사용자만 다운로드.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import desc, or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import write_bytes_async, ensure_dir_async, unlink_async
from app.core.permissions import require_permission
from app.core.quota import consume_quota, release_quota
from app.core.upload import POLICY_HWP, validate_upload
from app.models.classroom import Course, CourseStudent
from app.models.classroom_hwp import ClassroomHwp, HwpMember
from app.models.user import User


router = APIRouter(prefix="/api/classroom/hwps", tags=["classroom_hwps"])


STORAGE_BASE = Path(__file__).resolve().parents[3] / "storage" / "hwps"
MAX_FILE_BYTES = POLICY_HWP.max_size_bytes


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


async def _resolve_permission(
    db: AsyncSession, user: User, h: ClassroomHwp,
) -> dict:
    """반환 {can_read, can_write, can_share, role}."""
    if _is_admin(user) or h.owner_id == user.id:
        return {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}
    if h.is_archived:
        # 보관 중인 hwp는 owner/admin 외 편집 불가
        pass

    # member 조회
    m = (await db.execute(
        select(HwpMember).where(HwpMember.hwp_id == h.id, HwpMember.user_id == user.id)
    )).scalar_one_or_none()
    if m:
        return {
            "can_read": True,
            "can_write": (m.role == "editor") and not h.is_archived,
            "can_share": False,
            "role": m.role,
        }

    # access_mode 분기
    if h.access_mode == "link_public":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}
    if h.access_mode == "course_members" and h.course_id is not None:
        cs = (await db.execute(
            select(CourseStudent).where(
                CourseStudent.course_id == h.course_id,
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalar_one_or_none()
        course = await db.get(Course, h.course_id)
        is_teacher = course and course.teacher_id == user.id
        if cs or is_teacher:
            return {
                "can_read": True,
                "can_write": is_teacher and not h.is_archived,
                "can_share": is_teacher,
                "role": "teacher" if is_teacher else "student",
            }

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


def _meta_dict(h: ClassroomHwp, perm: dict, owner_name: str | None) -> dict:
    return {
        "id": h.id,
        "course_id": h.course_id,
        "owner_id": h.owner_id,
        "owner_name": owner_name,
        "title": h.title,
        "access_mode": h.access_mode,
        "file_path": h.file_path,
        "file_format": h.file_format,
        "is_archived": h.is_archived,
        "storage_bytes": h.storage_bytes,
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
        "permission": perm,
    }


# ─── CRUD ──────────────────────────────────────────────────────────


class HwpCreateBody(BaseModel):
    title: str = Field("제목 없는 HWP", max_length=255)
    course_id: int | None = None
    access_mode: str = Field("specific_users", pattern="^(specific_users|course_members|link_public)$")


@router.post("")
async def create_hwp(
    body: HwpCreateBody, request: Request,
    user: User = Depends(require_permission("classroom.hwp.create")),
    db: AsyncSession = Depends(get_db),
):
    """빈 HWP 메타만 생성 — 파일은 첫 업로드/저장 시 채워짐."""
    h = ClassroomHwp(
        title=body.title or "제목 없는 HWP",
        owner_id=user.id,
        course_id=body.course_id,
        access_mode=body.access_mode,
    )
    db.add(h)
    await db.flush()
    await log_action(db, user, "classroom.hwp.create", target=f"hwp:{h.id}", request=request)
    return _meta_dict(h, {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}, user.name)


@router.get("")
async def list_hwps(
    course_id: int | None = Query(None),
    mine: bool = Query(False),
    user: User = Depends(require_permission("classroom.hwp.view")),
    db: AsyncSession = Depends(get_db),
):
    """접근 가능한 HWP 목록 — owner/member/course_members/link_public."""
    q = select(ClassroomHwp).where(ClassroomHwp.deleted_at.is_(None))
    if course_id is not None:
        q = q.where(ClassroomHwp.course_id == course_id)
    if mine:
        q = q.where(ClassroomHwp.owner_id == user.id)
    q = q.order_by(desc(ClassroomHwp.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    # owner names
    owner_ids = {h.owner_id for h in rows}
    owners: dict[int, str] = {}
    if owner_ids:
        urows = (await db.execute(
            select(User).where(User.id.in_(owner_ids))
        )).scalars().all()
        owners = {u.id: u.name for u in urows}

    items = []
    for h in rows:
        perm = await _resolve_permission(db, user, h)
        if not perm["can_read"]:
            continue
        items.append(_meta_dict(h, perm, owners.get(h.owner_id)))
    return {"items": items}


@router.get("/{hid}")
async def get_hwp(
    hid: int,
    user: User = Depends(require_permission("classroom.hwp.view")),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(ClassroomHwp, hid)
    if not h or h.deleted_at is not None:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_read"]:
        raise HTTPException(403, "이 HWP에 대한 접근 권한이 없습니다")
    owner = await db.get(User, h.owner_id)
    return _meta_dict(h, perm, owner.name if owner else None)


class HwpUpdateBody(BaseModel):
    title: str | None = Field(None, max_length=255)
    access_mode: str | None = Field(None, pattern="^(specific_users|course_members|link_public)$")
    is_archived: bool | None = None


@router.put("/{hid}")
async def update_hwp(
    hid: int, body: HwpUpdateBody, request: Request,
    user: User = Depends(require_permission("classroom.hwp.edit")),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(ClassroomHwp, hid)
    if not h or h.deleted_at is not None:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_write"] and body.access_mode is not None and not perm["can_share"]:
        raise HTTPException(403)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(h, k, v)
    await db.flush()
    await log_action(db, user, "classroom.hwp.update", target=f"hwp:{hid}", request=request)
    return {"ok": True}


@router.delete("/{hid}")
async def delete_hwp(
    hid: int, request: Request,
    user: User = Depends(require_permission("classroom.hwp.edit")),
    db: AsyncSession = Depends(get_db),
):
    """soft delete (휴지통). 30일 후 영구 삭제 cron."""
    h = await db.get(ClassroomHwp, hid)
    if not h or h.deleted_at is not None:
        raise HTTPException(404)
    if not _is_admin(user) and h.owner_id != user.id:
        raise HTTPException(403, "본인 hwp만 삭제 가능")
    from datetime import datetime, timezone
    h.deleted_at = datetime.now(timezone.utc)
    h.deleted_by = user.id
    await log_action(db, user, "classroom.hwp.delete", target=f"hwp:{hid}", request=request)
    return {"ok": True}


# ─── 파일 업로드/다운로드 ────────────────────────────────────────────


@router.put("/{hid}/file")
async def upload_hwp_file(
    hid: int, request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("classroom.hwp.edit")),
    db: AsyncSession = Depends(get_db),
):
    """HWP 파일 본체 업로드/교체 — 에디터의 저장 또는 외부 파일 import."""
    h = await db.get(ClassroomHwp, hid)
    if not h or h.deleted_at is not None:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_write"]:
        raise HTTPException(403)

    # 확장자·크기 검증 (POLICY_HWP: .hwp/.hwpx, 30MB)
    data = await validate_upload(file, POLICY_HWP)
    name = (file.filename or "").lower()
    fmt = "hwpx" if name.endswith(".hwpx") else "hwp"

    # 경로 — storage/hwps/{id}/<uuid>.{fmt}
    sub = STORAGE_BASE / str(hid)
    await ensure_dir_async(sub)
    token = secrets.token_urlsafe(8)
    fname = f"{token}.{fmt}"
    fpath = sub / fname

    # 기존 파일 삭제 + quota 환원
    if h.file_path:
        try:
            await unlink_async(STORAGE_BASE.parent / h.file_path)
        except FileNotFoundError:
            pass
        if h.storage_bytes:
            owner = await db.get(User, h.owner_id)
            if owner:
                release_quota(owner, h.storage_bytes)

    await write_bytes_async(fpath, data)
    h.file_path = f"hwps/{hid}/{fname}"
    h.file_format = fmt
    h.storage_bytes = len(data)

    # quota 차감 (owner)
    owner = await db.get(User, h.owner_id)
    if owner:
        consume_quota(owner, len(data))

    await db.flush()
    await log_action(db, user, "classroom.hwp.upload", target=f"hwp:{hid} {fmt} {len(data)}B", request=request)
    return {"ok": True, "file_path": h.file_path, "file_format": fmt, "storage_bytes": h.storage_bytes}


# ─── 멤버 ───────────────────────────────────────────────────────────


@router.get("/{hid}/members")
async def list_members(
    hid: int,
    user: User = Depends(require_permission("classroom.hwp.view")),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(ClassroomHwp, hid)
    if not h:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_read"]:
        raise HTTPException(403)
    rows = (await db.execute(
        select(HwpMember, User)
        .join(User, User.id == HwpMember.user_id)
        .where(HwpMember.hwp_id == hid)
        .order_by(User.name)
    )).all()
    return {
        "items": [
            {
                "id": m.id, "user_id": u.id,
                "user_name": u.name, "name": u.name,
                "email": u.email, "role": m.role,
            }
            for m, u in rows
        ]
    }


class MemberBody(BaseModel):
    user_id: int
    role: str = Field("editor", pattern="^(editor|viewer)$")


@router.post("/{hid}/members")
async def add_member(
    hid: int, body: MemberBody, request: Request,
    user: User = Depends(require_permission("classroom.hwp.share")),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(ClassroomHwp, hid)
    if not h:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_share"]:
        raise HTTPException(403)
    existing = (await db.execute(
        select(HwpMember).where(HwpMember.hwp_id == hid, HwpMember.user_id == body.user_id)
    )).scalar_one_or_none()
    if existing:
        existing.role = body.role
        await db.flush()
        return {"ok": True, "id": existing.id, "updated": True}
    m = HwpMember(hwp_id=hid, user_id=body.user_id, role=body.role)
    db.add(m)
    await db.flush()
    await log_action(db, user, "classroom.hwp.member.add", target=f"hwp:{hid} user:{body.user_id}", request=request)
    return {"ok": True, "id": m.id}


@router.delete("/{hid}/members/{uid}")
async def remove_member(
    hid: int, uid: int, request: Request,
    user: User = Depends(require_permission("classroom.hwp.share")),
    db: AsyncSession = Depends(get_db),
):
    h = await db.get(ClassroomHwp, hid)
    if not h:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_share"]:
        raise HTTPException(403)
    m = (await db.execute(
        select(HwpMember).where(HwpMember.hwp_id == hid, HwpMember.user_id == uid)
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await log_action(db, user, "classroom.hwp.member.remove", target=f"hwp:{hid} user:{uid}", request=request)
    return {"ok": True}
