"""공유 화이트보드 라우터 — tool_board와 동일 골격 (Yjs 도구 규약).

prefix /api/classroom/whiteboards: Hocuspocus가
`{FASTAPI}/api/classroom/{resourcePath}/{id}/permission|yjs-snapshot` 규약으로 호출
(auth.ts resourcePath("whiteboard") → "whiteboards").

엔드포인트:
  관리 (tools.whiteboard.manage — 교사):
    GET    /api/classroom/whiteboards                    — 본인 목록
    POST   /api/classroom/whiteboards                    — 생성
    PUT    /api/classroom/whiteboards/{wid}              — 설정 (owner)
    DELETE /api/classroom/whiteboards/{wid}              — 휴지통 이동 (owner)
    GET    /api/classroom/whiteboards/shared-with-me     — 나에게 공유됨
    GET/POST/DELETE .../{wid}/shares[/{share_id}]        — 동료 교사 공유
    POST   /api/classroom/whiteboards/{wid}/duplicate    — 사본 (공유받은 교사 포함)

  참여 (인증 + 접근 가드):
    GET /api/classroom/whiteboards/{wid}                 — 메타 + 본인 권한

  Hocuspocus 내부:
    GET  .../{wid}/permission    (사용자 JWT)
    GET/POST .../{wid}/yjs-snapshot  (INTERNAL_TOKEN)

스트로크 본체는 Yjs Y.Map("strokes") — 서버는 snapshot bytes만 저장.
접근 매트릭스는 보드와 동일: 강좌멤버/글첨부/public 전부 읽기+쓰기(참여형).
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Text as SaText, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.core.quota import adjust_quota
from app.models import CoursePost, CourseStudent, ToolWhiteboard, User
from app.models.classroom import Course
from app.modules.classroom.teachers import is_course_editor_or_admin

router = APIRouter(prefix="/api/classroom/whiteboards", tags=["tool-whiteboard"])

MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024


# ── Pydantic ──

class WhiteboardCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    course_id: int | None = None
    access_mode: str = Field(default="members", pattern="^(members|public)$")
    background: str = Field(default="white", pattern="^(white|grid|dark)$")


class WhiteboardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    course_id: int | None = None
    access_mode: str | None = Field(default=None, pattern="^(members|public)$")
    background: str | None = Field(default=None, pattern="^(white|grid|dark)$")
    is_archived: bool | None = None


class SnapshotIn(BaseModel):
    state_base64: str = Field(..., min_length=1)


class ShareAdd(BaseModel):
    user_id: int


# ── helpers ──

def _to_dict(w: ToolWhiteboard, *, owner_name: str | None = None) -> dict:
    return {
        "id": w.id,
        "owner_id": w.owner_id,
        "owner_name": owner_name,
        "title": w.title,
        "description": w.description,
        "course_id": w.course_id,
        "access_mode": w.access_mode,
        "background": (w.settings or {}).get("background") or "white",
        "is_archived": w.is_archived,
        "created_at": w.created_at.isoformat() if w.created_at else None,
        "updated_at": w.updated_at.isoformat() if w.updated_at else None,
    }


async def _has_classroom_attachment(
    db: AsyncSession, user: User, wid: int,
) -> bool:
    """본인 소속 **활성 학기** 강좌 글에 whiteboard 첨부 (보드와 동일 — 라이브 활동)."""
    from app.models import Semester

    active_sid = (await db.execute(
        select(Semester.id).where(Semester.is_current == True)  # noqa: E712
    )).scalars().first()
    if not active_sid:
        return False
    student_ids = (await db.execute(
        select(CourseStudent.course_id)
        .join(Course, Course.id == CourseStudent.course_id)
        .where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
            Course.semester_id == active_sid,
        )
    )).scalars().all()
    if not student_ids:
        return False
    rows = (await db.execute(
        select(CoursePost.attachments).where(
            CoursePost.course_id.in_(set(student_ids)),
            CoursePost.attachments.isnot(None),
            cast(CoursePost.attachments, SaText).like('%"whiteboard_id"%'),
        )
    )).scalars().all()
    for atts in rows:
        if not isinstance(atts, list):
            continue
        for a in atts:
            if (
                isinstance(a, dict)
                and a.get("type") == "whiteboard"
                and a.get("whiteboard_id") == wid
            ):
                return True
    return False


async def _resolve_permission(db: AsyncSession, user: User, w: ToolWhiteboard) -> dict:
    """참여형 — 접근 가능하면 쓰기 허용 (archived는 읽기만). 공유받은 교사는 열람만."""
    def perm(read: bool, write: bool, share: bool, role: str | None) -> dict:
        if w.is_archived:
            write = False
        return {"can_read": read, "can_write": write, "can_share": share, "role": role}

    if w.owner_id == user.id:
        return perm(True, True, True, "owner")
    if is_admin(user):
        return perm(True, True, True, "admin")

    if w.course_id is not None:
        course = await db.get(Course, w.course_id)
        if course:
            if await is_course_editor_or_admin(db, course, user):
                return perm(True, True, False, "editor")
            cs = (await db.execute(
                select(CourseStudent).where(
                    CourseStudent.course_id == w.course_id,
                    CourseStudent.student_id == user.id,
                    CourseStudent.status == "active",
                )
            )).scalar_one_or_none()
            if cs:
                return perm(True, True, False, "editor")

    if await _has_classroom_attachment(db, user, w.id):
        return perm(True, True, False, "editor")

    if w.access_mode == "public":
        return perm(True, True, False, "editor")

    # 동료 교사 공유 — 열람 전용 (사본으로 가져가서 사용)
    from app.services.tool_share import is_shared_to
    if await is_shared_to(db, "whiteboard", w.id, user.id):
        return perm(True, False, False, "viewer")

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


async def _get_wb_or_404(db: AsyncSession, wid: int) -> ToolWhiteboard:
    w = await db.get(ToolWhiteboard, wid)
    if not w or w.deleted_at is not None:
        raise HTTPException(404, "화이트보드 없음")
    return w


# ── 관리 (교사) ──

@router.get("")
async def my_whiteboards(
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ToolWhiteboard).where(
            ToolWhiteboard.owner_id == user.id,
            ToolWhiteboard.deleted_at.is_(None),
        ).order_by(ToolWhiteboard.updated_at.desc()).limit(100)
    )).scalars().all()
    return {"items": [_to_dict(w) for w in rows]}


@router.post("")
async def create_whiteboard(
    body: WhiteboardCreate, request: Request,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not await is_course_editor_or_admin(db, course, user):
            raise HTTPException(403, "본인 강좌에만 연결 가능")
    w = ToolWhiteboard(
        owner_id=user.id,
        title=body.title,
        description=body.description,
        course_id=body.course_id,
        access_mode=body.access_mode,
        settings={"background": body.background},
    )
    db.add(w)
    await db.flush()
    await log_action(db, user, "tools.whiteboard.create", target=f"wb:{w.id}", request=request)
    return _to_dict(w, owner_name=user.name)


@router.put("/{wid}")
async def update_whiteboard(
    wid: int, body: WhiteboardUpdate, request: Request,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    w = await _get_wb_or_404(db, wid)
    if w.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 화이트보드만 설정 가능")
    patch = body.model_dump(exclude_unset=True)
    bg = patch.pop("background", None)
    if bg is not None:
        w.settings = {**(w.settings or {}), "background": bg}
    if "course_id" in patch and patch["course_id"] is not None:
        course = await db.get(Course, patch["course_id"])
        if not course:
            raise HTTPException(404, "강좌 없음")
    for k, v in patch.items():
        setattr(w, k, v)
    await db.flush()
    await db.refresh(w)
    await log_action(db, user, "tools.whiteboard.update", target=f"wb:{wid}", request=request)
    return _to_dict(w)


@router.delete("/{wid}")
async def delete_whiteboard(
    wid: int, request: Request,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    w = await _get_wb_or_404(db, wid)
    if w.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 화이트보드만 삭제 가능")
    # 드라이브 휴지통으로 (30일 보관 — 공유 row는 복구 대비 유지)
    w.deleted_at = datetime.now(timezone.utc)
    w.deleted_by = user.id
    await db.flush()
    await log_action(db, user, "tools.whiteboard.delete", target=f"wb:{wid}", request=request)
    return {"ok": True, "trashed": True}


# ── 동료 교사 공유 + 사본 (참여용 GET /{wid}보다 먼저 등록) ──

@router.get("/shared-with-me")
async def shared_with_me(
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import shared_tool_ids
    ids = await shared_tool_ids(db, "whiteboard", user.id)
    if not ids:
        return {"items": []}
    rows = (await db.execute(
        select(ToolWhiteboard, User.name)
        .join(User, User.id == ToolWhiteboard.owner_id)
        .where(ToolWhiteboard.id.in_(ids), ToolWhiteboard.deleted_at.is_(None))
        .order_by(ToolWhiteboard.updated_at.desc())
    )).all()
    return {"items": [_to_dict(w, owner_name=name) for w, name in rows]}


@router.get("/{wid}/shares")
async def list_wb_shares(
    wid: int,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import list_shares
    w = await _get_wb_or_404(db, wid)
    if w.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 화이트보드만 공유 관리 가능")
    return {"items": await list_shares(db, "whiteboard", wid)}


@router.post("/{wid}/shares")
async def add_wb_share(
    wid: int, body: ShareAdd, request: Request,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import add_share
    w = await _get_wb_or_404(db, wid)
    if w.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 화이트보드만 공유 가능")
    out = await add_share(
        db, tool_type="whiteboard", tool_id=wid,
        target_user_id=body.user_id, shared_by=user.id,
    )
    await log_action(db, user, "tools.whiteboard.share", target=f"wb:{wid} to:{body.user_id}", request=request)
    return out


@router.delete("/{wid}/shares/{share_id}")
async def remove_wb_share(
    wid: int, share_id: int,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import remove_share
    w = await _get_wb_or_404(db, wid)
    if w.owner_id != user.id and not is_admin(user):
        raise HTTPException(403)
    await remove_share(db, tool_type="whiteboard", tool_id=wid, share_id=share_id)
    return {"ok": True}


@router.post("/{wid}/duplicate")
async def duplicate_whiteboard(
    wid: int, request: Request,
    user: User = Depends(require_permission("tools.whiteboard.manage")),
    db: AsyncSession = Depends(get_db),
):
    """사본 — 소유자/공유받은 교사/관리자. 그림(yjs_state)까지 복제, 원본 보존."""
    from app.services.tool_share import is_shared_to
    src = await _get_wb_or_404(db, wid)
    if not (
        src.owner_id == user.id
        or is_admin(user)
        or await is_shared_to(db, "whiteboard", wid, user.id)
    ):
        raise HTTPException(403, "공유받은 화이트보드만 사본을 만들 수 있습니다")

    copy = ToolWhiteboard(
        owner_id=user.id,
        title=f"{src.title} (사본)"[:255],
        description=src.description,
        course_id=None,
        access_mode="members",
        settings=dict(src.settings or {}),
        yjs_state=src.yjs_state,
        storage_bytes=src.storage_bytes or 0,
    )
    db.add(copy)
    await db.flush()
    await log_action(db, user, "tools.whiteboard.duplicate", target=f"wb:{wid} -> {copy.id}", request=request)
    return _to_dict(copy, owner_name=user.name)


# ── 참여 ──

@router.get("/{wid}")
async def get_whiteboard(
    wid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    w = await _get_wb_or_404(db, wid)
    perm = await _resolve_permission(db, user, w)
    if not perm["can_read"]:
        raise HTTPException(403, "이 화이트보드에 접근 권한이 없습니다")
    owner = await db.get(User, w.owner_id)
    return {
        **_to_dict(w, owner_name=owner.name if owner else None),
        "permission": perm,
    }


# ── Hocuspocus 사이드카 연동 ──

@router.get("/{wid}/permission")
async def check_wb_permission(
    wid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    w = await _get_wb_or_404(db, wid)
    return await _resolve_permission(db, user, w)


@router.get("/{wid}/yjs-snapshot")
async def get_yjs_snapshot(
    wid: int,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")
    w = await _get_wb_or_404(db, wid)
    if w.yjs_state is None:
        return {"state_base64": None, "whiteboard_id": wid}
    return {
        "state_base64": base64.b64encode(w.yjs_state).decode("ascii"),
        "whiteboard_id": wid,
    }


@router.post("/{wid}/yjs-snapshot")
async def put_yjs_snapshot(
    wid: int, body: SnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")
    w = await _get_wb_or_404(db, wid)
    try:
        data = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "잘못된 base64")
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "snapshot이 너무 큽니다 (10MB 한도)")
    old_bytes = w.storage_bytes or 0
    w.yjs_state = data
    w.storage_bytes = len(data)
    await db.flush()
    try:
        owner = await db.get(User, w.owner_id)
        if owner:
            await adjust_quota(db, owner, old_bytes=old_bytes, new_bytes=len(data))
    except Exception:
        pass
    return {"ok": True, "byte_size": len(data)}
