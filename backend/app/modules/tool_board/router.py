"""보드 (Padlet형) 라우터.

prefix가 /api/classroom/boards 인 이유: Hocuspocus 사이드카가
`{FASTAPI}/api/classroom/{resourcePath}/{id}/permission|yjs-snapshot` 규약으로
호출한다 (auth.ts resourcePath("board") → "boards"). doc/deck/sheet와 동일.

엔드포인트:
  관리 (tools.board.manage — 교사):
    GET    /api/classroom/boards            — 본인 보드 list
    POST   /api/classroom/boards            — 생성
    PUT    /api/classroom/boards/{bid}      — 메타·컬럼·접근 설정 (owner)
    DELETE /api/classroom/boards/{bid}      — 삭제 (owner)

  참여 (인증 + 접근 가드):
    GET /api/classroom/boards/{bid}         — 메타 + 본인 권한 (보드 화면 진입)

  Hocuspocus 내부:
    GET  /api/classroom/boards/{bid}/permission    (사용자 JWT)
    GET  /api/classroom/boards/{bid}/yjs-snapshot  (INTERNAL_TOKEN)
    POST /api/classroom/boards/{bid}/yjs-snapshot  (INTERNAL_TOKEN)

카드 본문은 Yjs Y.Map("cards") — 서버는 snapshot bytes만 저장.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import Text as SaText, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.core.quota import adjust_quota
from app.models import CoursePost, CourseStudent, ToolBoard, User
from app.models.classroom import Course
from app.modules.classroom.teachers import is_course_editor_or_admin

router = APIRouter(prefix="/api/classroom/boards", tags=["tool-board"])

DEFAULT_COLUMNS = ["아이디어", "질문", "기타"]
MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024


# ── Pydantic ──

class BoardCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    course_id: int | None = None
    access_mode: str = Field(default="members", pattern="^(members|public)$")
    columns: list[str] | None = None  # 미지정 시 DEFAULT_COLUMNS


class BoardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    course_id: int | None = None
    access_mode: str | None = Field(default=None, pattern="^(members|public)$")
    columns: list[str] | None = Field(default=None, max_length=10)
    # 배경 테마 키 (frontend BOARD_BACKGROUNDS 프리셋) — settings.background에 저장
    background: str | None = Field(default=None, max_length=30)
    is_archived: bool | None = None
    # ── Padlet 동급 설정 (settings JSON에 머지) ──
    requires_approval: bool | None = None          # 승인 후 게시 (moderator가 승인)
    hide_authors: bool | None = None               # 작성자 익명 표시 (moderator 외)
    new_card_position: str | None = Field(default=None, pattern="^(top|bottom)$")
    default_sort: str | None = Field(default=None, pattern="^(manual|newest|likes)$")
    # 레이아웃 — shelf(섹션 컬럼) | canvas(자유배치 x/y 드래그)
    layout: str | None = Field(default=None, pattern="^(shelf|canvas)$")


class ShareAdd(BaseModel):
    user_id: int = Field(..., gt=0)


class SnapshotIn(BaseModel):
    state_base64: str = Field(..., min_length=1)


# ── helpers ──

def _to_dict(b: ToolBoard, *, owner_name: str | None = None) -> dict:
    return {
        "id": b.id,
        "owner_id": b.owner_id,
        "owner_name": owner_name,
        "title": b.title,
        "description": b.description,
        "course_id": b.course_id,
        "access_mode": b.access_mode,
        "columns": (b.settings or {}).get("columns") or DEFAULT_COLUMNS,
        "background": (b.settings or {}).get("background") or "cream",
        "requires_approval": bool((b.settings or {}).get("requires_approval")),
        "hide_authors": bool((b.settings or {}).get("hide_authors")),
        "new_card_position": (b.settings or {}).get("new_card_position") or "top",
        "default_sort": (b.settings or {}).get("default_sort") or "newest",
        "layout": (b.settings or {}).get("layout") or "shelf",
        "is_archived": b.is_archived,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


async def _has_classroom_attachment(
    db: AsyncSession, user: User, board_id: int,
) -> bool:
    """본인 소속 강좌 글에 이 보드가 첨부됐는지 (LIKE prefilter + Python 매칭).

    **활성 학기 강좌만** — 학기가 바뀌면 이전 학기 첨부로는 접근 불가.
    (보드는 수업 중 라이브 활동 — 새 학기엔 교사가 새 강좌 글에 다시 첨부)
    """
    from app.core.semester import get_active_semester_id_or_404

    student_ids = (await db.execute(
        select(CourseStudent.course_id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()
    if not student_ids:
        return False
    try:
        active_sid = await get_active_semester_id_or_404(db)
    except HTTPException:
        return False
    rows = (await db.execute(
        select(CoursePost.attachments)
        .join(Course, Course.id == CoursePost.course_id)
        .where(
            CoursePost.course_id.in_(set(student_ids)),
            Course.semester_id == active_sid,
            CoursePost.attachments.isnot(None),
            cast(CoursePost.attachments, SaText).like('%"board_id"%'),
        )
    )).scalars().all()
    for atts in rows:
        if not isinstance(atts, list):
            continue
        for a in atts:
            if (
                isinstance(a, dict)
                and a.get("type") == "board"
                and a.get("board_id") == board_id
            ):
                return True
    return False


async def _resolve_permission(db: AsyncSession, user: User, b: ToolBoard) -> dict:
    """보드는 '참여'가 목적 — 접근 가능하면 기본 쓰기 허용 (archived는 읽기만)."""
    def perm(read: bool, write: bool, share: bool, role: str | None) -> dict:
        if b.is_archived:
            write = False
        return {"can_read": read, "can_write": write, "can_share": share, "role": role}

    if b.owner_id == user.id:
        return perm(True, True, True, "owner")
    if is_admin(user):
        return perm(True, True, True, "admin")

    if b.course_id is not None:
        course = await db.get(Course, b.course_id)
        if course:
            if await is_course_editor_or_admin(db, course, user):
                return perm(True, True, False, "editor")
            # 학생은 **활성 학기** 강좌만 (보드는 라이브 수업 활동 — 학기 귀속)
            from app.core.semester import get_active_semester_id_or_404
            try:
                active_sid = await get_active_semester_id_or_404(db)
            except HTTPException:
                active_sid = None
            if active_sid is not None and course.semester_id == active_sid:
                cs = (await db.execute(
                    select(CourseStudent).where(
                        CourseStudent.course_id == b.course_id,
                        CourseStudent.student_id == user.id,
                        CourseStudent.status == "active",
                    )
                )).scalar_one_or_none()
                if cs:
                    return perm(True, True, False, "editor")

    if await _has_classroom_attachment(db, user, b.id):
        return perm(True, True, False, "editor")

    if b.access_mode == "public":
        return perm(True, True, False, "editor")

    # 동료 교사 공유 — 원본은 열람만 (수업에 쓰려면 사본 생성)
    from app.services.tool_share import is_shared_to
    if await is_shared_to(db, "board", b.id, user.id):
        return perm(True, False, False, "viewer")

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


async def _get_board_or_404(db: AsyncSession, bid: int) -> ToolBoard:
    b = await db.get(ToolBoard, bid)
    if not b or b.deleted_at is not None:  # 휴지통 자료는 드라이브에서만 (복구/영구삭제)
        raise HTTPException(404, "보드 없음")
    return b


# ── 관리 (교사) ──

@router.get("")
async def my_boards(
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(ToolBoard).where(
            ToolBoard.owner_id == user.id,
            ToolBoard.deleted_at.is_(None),
        )
        .order_by(ToolBoard.updated_at.desc()).limit(100)
    )).scalars().all()
    return {"items": [_to_dict(b) for b in rows]}


@router.post("")
async def create_board(
    body: BoardCreate, request: Request,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not await is_course_editor_or_admin(db, course, user):
            raise HTTPException(403, "본인 강좌에만 연결 가능")
    cols = [c.strip()[:50] for c in (body.columns or DEFAULT_COLUMNS) if c.strip()][:10]
    b = ToolBoard(
        owner_id=user.id,
        title=body.title,
        description=body.description,
        course_id=body.course_id,
        access_mode=body.access_mode,
        settings={"columns": cols or DEFAULT_COLUMNS},
    )
    db.add(b)
    await db.flush()
    await log_action(db, user, "tools.board.create", target=f"board:{b.id}", request=request)
    return _to_dict(b, owner_name=user.name)


@router.put("/{bid}")
async def update_board(
    bid: int, body: BoardUpdate, request: Request,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    b = await _get_board_or_404(db, bid)
    if b.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 보드만 설정 가능")
    patch = body.model_dump(exclude_unset=True)
    cols = patch.pop("columns", None)
    if cols is not None:
        cleaned = [c.strip()[:50] for c in cols if c.strip()][:10]
        if not cleaned:
            raise HTTPException(400, "컬럼은 1개 이상 필요")
        b.settings = {**(b.settings or {}), "columns": cleaned}
    background = patch.pop("background", None)
    if background is not None:
        b.settings = {**(b.settings or {}), "background": background.strip()[:30]}
    # Padlet 동급 설정 — settings JSON에 머지
    for sk in ("requires_approval", "hide_authors", "new_card_position", "default_sort", "layout"):
        if sk in patch:
            b.settings = {**(b.settings or {}), sk: patch.pop(sk)}
    if "course_id" in patch and patch["course_id"] is not None:
        course = await db.get(Course, patch["course_id"])
        if not course:
            raise HTTPException(404, "강좌 없음")
    for k, v in patch.items():
        setattr(b, k, v)
    await db.flush()
    await db.refresh(b)
    await log_action(db, user, "tools.board.update", target=f"board:{bid}", request=request)
    return _to_dict(b)


@router.delete("/{bid}")
async def delete_board(
    bid: int, request: Request,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    b = await _get_board_or_404(db, bid)
    if b.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 보드만 삭제 가능")
    # 드라이브 휴지통으로 (30일 보관 후 cron이 hard delete — 공유는 복구 대비 유지)
    b.deleted_at = datetime.now(timezone.utc)
    b.deleted_by = user.id
    await db.flush()
    await log_action(db, user, "tools.board.delete", target=f"board:{bid}", request=request)
    return {"ok": True, "trashed": True}


# ── 동료 교사 공유 + 사본 ──

# NOTE: 참여용 GET /{bid}보다 파일에서 먼저 등록돼야 함 (등록 순서 매칭).
@router.get("/shared-with-me")
async def shared_with_me(
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    """나에게 공유된 보드 목록 (열람 + 사본 생성 가능)."""
    from app.services.tool_share import shared_tool_ids
    ids = await shared_tool_ids(db, "board", user.id)
    if not ids:
        return {"items": []}
    rows = (await db.execute(
        select(ToolBoard, User.name)
        .join(User, User.id == ToolBoard.owner_id)
        .where(ToolBoard.id.in_(ids), ToolBoard.deleted_at.is_(None))
        .order_by(ToolBoard.updated_at.desc())
    )).all()
    return {"items": [_to_dict(b, owner_name=name) for b, name in rows]}


@router.get("/{bid}/shares")
async def list_board_shares(
    bid: int,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import list_shares
    b = await _get_board_or_404(db, bid)
    if b.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 보드만 공유 관리 가능")
    return {"items": await list_shares(db, "board", bid)}


@router.post("/{bid}/shares")
async def add_board_share(
    bid: int, body: ShareAdd, request: Request,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import add_share
    b = await _get_board_or_404(db, bid)
    if b.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 보드만 공유 가능")
    out = await add_share(
        db, tool_type="board", tool_id=bid,
        target_user_id=body.user_id, shared_by=user.id,
    )
    await log_action(db, user, "tools.board.share", target=f"board:{bid} to:{body.user_id}", request=request)
    return out


@router.delete("/{bid}/shares/{share_id}")
async def remove_board_share(
    bid: int, share_id: int,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import remove_share
    b = await _get_board_or_404(db, bid)
    if b.owner_id != user.id and not is_admin(user):
        raise HTTPException(403)
    await remove_share(db, tool_type="board", tool_id=bid, share_id=share_id)
    return {"ok": True}


@router.post("/{bid}/duplicate")
async def duplicate_board(
    bid: int, request: Request,
    user: User = Depends(require_permission("tools.board.manage")),
    db: AsyncSession = Depends(get_db),
):
    """사본 생성 — 소유자/공유받은 교사/관리자. 카드(yjs_state)까지 복제, 원본 보존.

    공유받은 교사가 본인 수업에 쓸 때의 흐름: 원본 열람 → 사본 → 본인 강좌에 첨부.
    """
    from app.services.tool_share import is_shared_to
    src = await _get_board_or_404(db, bid)
    if not (
        src.owner_id == user.id
        or is_admin(user)
        or await is_shared_to(db, "board", bid, user.id)
    ):
        raise HTTPException(403, "공유받은 보드만 사본을 만들 수 있습니다")

    copy = ToolBoard(
        owner_id=user.id,
        title=f"{src.title} (사본)"[:255],
        description=src.description,
        course_id=None,                # 강좌 연결은 사본 소유자가 직접
        access_mode="members",
        settings=dict(src.settings or {}),
        yjs_state=src.yjs_state,       # 카드 전체 복제 (이후 서로 독립)
        storage_bytes=src.storage_bytes or 0,
    )
    db.add(copy)
    await db.flush()
    await log_action(db, user, "tools.board.duplicate", target=f"board:{bid} -> {copy.id}", request=request)
    return _to_dict(copy, owner_name=user.name)


# ── 카드 댓글 알림 (best-effort — 댓글 자체는 Yjs, 알림만 backend) ──

class CommentNotify(BaseModel):
    recipient_id: int
    excerpt: str = Field(..., min_length=1, max_length=200)


@router.post("/{bid}/notify-comment")
async def notify_card_comment(
    bid: int, body: CommentNotify,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """카드 작성자에게 댓글 알림 — 보드 can_write 멤버만 호출 가능."""
    from app.services.notification import notify_users

    b = await _get_board_or_404(db, bid)
    perm = await _resolve_permission(db, user, b)
    if not perm["can_write"]:
        raise HTTPException(403)
    recipient = await db.get(User, body.recipient_id)
    if not recipient:
        return {"ok": True, "notified": 0}
    link = f"/s/board/{bid}" if recipient.role == "student" else f"/tools/board/{bid}"
    n = await notify_users(
        db, user_ids=[recipient.id], type="board_comment",
        title=f"보드 '{b.title}' — 내 카드에 댓글",
        body=f"{user.name}: {body.excerpt}",
        link_url=link, source_user_id=user.id,
    )
    return {"ok": True, "notified": n}


# ── 카드 이미지 업로드 (can_write — 카드 작성자가 직접 올림) ──

@router.post("/{bid}/upload-image")
async def upload_card_image(
    bid: int, file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """카드 첨부 이미지 업로드 — PIL 압축 후 storage/boards/{bid}/ 저장.

    응답 url은 /storage/boards/... — frontend는 인증 fetch(blob)로 표시
    (files/router.py `_guard_boards`가 보드 can_read로 보호).
    """
    import asyncio
    import io as _io
    import secrets

    from app.core.files import (
        DEFAULT_STORAGE_ROOT, ensure_dir_async, write_bytes_async,
    )
    from app.core.quota import adjust_quota
    from app.core.upload import POLICY_IMAGE, validate_upload

    b = await _get_board_or_404(db, bid)
    perm = await _resolve_permission(db, user, b)
    if not perm["can_write"]:
        raise HTTPException(403, "카드 작성 권한이 없습니다")

    data = await validate_upload(file, POLICY_IMAGE)

    def _compress() -> bytes:
        from PIL import Image
        img = Image.open(_io.BytesIO(data))
        img = img.convert("RGB")
        img.thumbnail((1400, 1400))
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=82)
        return buf.getvalue()

    try:
        out = await asyncio.to_thread(_compress)
    except Exception:
        raise HTTPException(400, "이미지를 처리할 수 없습니다")

    fname = f"{secrets.token_urlsafe(10)}.jpg"
    rel = f"boards/{bid}/{fname}"
    full = DEFAULT_STORAGE_ROOT / rel
    await ensure_dir_async(full.parent)
    await write_bytes_async(full, out)

    # 보드 소유자 quota에 합산 (best-effort — drive 영구삭제 시 storage_bytes로 환원)
    old_bytes = b.storage_bytes or 0
    b.storage_bytes = old_bytes + len(out)
    await db.flush()
    try:
        owner = await db.get(User, b.owner_id)
        if owner:
            await adjust_quota(db, owner, old_bytes=old_bytes, new_bytes=b.storage_bytes)
    except Exception:
        pass

    return {"url": f"/storage/{rel}", "byte_size": len(out)}


# ── 참여 (보드 화면 진입) ──

@router.get("/{bid}")
async def get_board(
    bid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    b = await _get_board_or_404(db, bid)
    perm = await _resolve_permission(db, user, b)
    if not perm["can_read"]:
        raise HTTPException(403, "이 보드에 접근 권한이 없습니다")
    owner = await db.get(User, b.owner_id)
    return {
        **_to_dict(b, owner_name=owner.name if owner else None),
        "permission": perm,
    }


# ── Hocuspocus 사이드카 연동 (classroom_sheets와 동일 패턴) ──

@router.get("/{bid}/permission")
async def check_board_permission(
    bid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus WS auth 단계 — 사용자 JWT 인증."""
    b = await _get_board_or_404(db, bid)
    return await _resolve_permission(db, user, b)


@router.get("/{bid}/yjs-snapshot")
async def get_yjs_snapshot(
    bid: int,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """보드 초기 로딩 — INTERNAL_TOKEN 인증 (Hocuspocus 전용)."""
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")
    b = await _get_board_or_404(db, bid)
    if b.yjs_state is None:
        return {"state_base64": None, "board_id": bid}
    return {
        "state_base64": base64.b64encode(b.yjs_state).decode("ascii"),
        "board_id": bid,
    }


@router.post("/{bid}/yjs-snapshot")
async def put_yjs_snapshot(
    bid: int, body: SnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 주기 저장 — INTERNAL_TOKEN 인증."""
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")
    b = await _get_board_or_404(db, bid)
    try:
        data = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "잘못된 base64")
    if len(data) > MAX_SNAPSHOT_BYTES:
        raise HTTPException(413, "snapshot이 너무 큽니다 (10MB 한도)")
    old_bytes = b.storage_bytes or 0
    b.yjs_state = data
    b.storage_bytes = len(data)
    await db.flush()

    # quota 조정 (best-effort — sheets와 동일)
    try:
        owner = await db.get(User, b.owner_id)
        if owner:
            await adjust_quota(db, owner, old_bytes=old_bytes, new_bytes=len(data))
    except Exception:
        pass

    return {"ok": True, "byte_size": len(data)}
