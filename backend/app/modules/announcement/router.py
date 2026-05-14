"""공지사항 라우터 — CRUD + visibility 정책

규칙:
- 작성: announcement.post.create 권한 (교사 이상)
- 수정/삭제: 본인이 작성자이거나, super_admin / designated_admin
- 열람: announcement.post.view 권한 (모든 역할에 부여). 학생은 audience='all'만 보임.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.announcement import Announcement, AnnouncementAudience
from app.models.user import User

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


def _can_edit(user: User, post: Announcement) -> bool:
    if _is_admin(user):
        return True
    return post.author_id == user.id


def _audience_filter_for(user: User):
    """학생은 audience='all'만 본다. 교직원·관리자는 모두."""
    if user.role == "student":
        return Announcement.audience == AnnouncementAudience.ALL
    return None


@router.get("")
async def list_announcements(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    audience: str | None = Query(None, description="필터: all|staff (관리자만 의미)"),
    user: User = Depends(require_permission("announcement.post.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(Announcement)
    cq = select(func.count(Announcement.id))

    af = _audience_filter_for(user)
    if af is not None:
        q = q.where(af)
        cq = cq.where(af)

    # 관리자/교직원이 audience 필터 지정 가능
    if audience and user.role != "student":
        try:
            aud = AnnouncementAudience(audience)
            q = q.where(Announcement.audience == aud)
            cq = cq.where(Announcement.audience == aud)
        except ValueError:
            raise HTTPException(400, f"잘못된 audience: {audience}")

    total = (await db.execute(cq)).scalar_one()
    rows = (await db.execute(
        q.order_by(desc(Announcement.is_pinned), desc(Announcement.created_at))
         .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    # author name lookup (단순 — 작성자 N+1이지만 페이지당 20개라 OK)
    author_ids = {a.author_id for a in rows if a.author_id}
    authors = {}
    if author_ids:
        for u in (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all():
            authors[u.id] = u.name

    return {
        "items": [
            {
                "id": a.id,
                "title": a.title,
                "body": a.body,
                "audience": a.audience.value if hasattr(a.audience, "value") else a.audience,
                "is_pinned": a.is_pinned,
                "author_id": a.author_id,
                "author_name": authors.get(a.author_id) if a.author_id else None,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "updated_at": a.updated_at.isoformat() if a.updated_at else None,
                "can_edit": _can_edit(user, a),
            }
            for a in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{ann_id}")
async def get_announcement(
    ann_id: int,
    user: User = Depends(require_permission("announcement.post.view")),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(Announcement).where(Announcement.id == ann_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다")

    # 학생이 staff-only 글을 직접 ID로 접근하면 차단
    if user.role == "student" and a.audience != AnnouncementAudience.ALL:
        raise HTTPException(403, "열람 권한이 없는 공지입니다")

    author_name = None
    if a.author_id:
        au = (await db.execute(select(User).where(User.id == a.author_id))).scalar_one_or_none()
        author_name = au.name if au else None

    return {
        "id": a.id,
        "title": a.title,
        "body": a.body,
        "audience": a.audience.value if hasattr(a.audience, "value") else a.audience,
        "is_pinned": a.is_pinned,
        "author_id": a.author_id,
        "author_name": author_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "can_edit": _can_edit(user, a),
    }


@router.post("")
async def create_announcement(
    body: dict,
    request: Request = None,
    user: User = Depends(require_permission("announcement.post.create")),
    db: AsyncSession = Depends(get_db),
):
    title = (body.get("title") or "").strip()
    content = (body.get("body") or "").strip()
    if not title:
        raise HTTPException(400, "제목을 입력하세요")
    if not content:
        raise HTTPException(400, "본문을 입력하세요")
    audience_raw = body.get("audience") or "all"
    try:
        audience = AnnouncementAudience(audience_raw)
    except ValueError:
        raise HTTPException(400, f"잘못된 audience: {audience_raw}")

    a = Announcement(
        title=title[:200],
        body=content,
        audience=audience,
        is_pinned=bool(body.get("is_pinned", False)),
        author_id=user.id,
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "announcement.create", f"announcement:{a.id}", request=request)
    return {"id": a.id, "title": a.title}


@router.put("/{ann_id}")
async def update_announcement(
    ann_id: int,
    body: dict,
    request: Request = None,
    user: User = Depends(require_permission("announcement.post.edit")),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(Announcement).where(Announcement.id == ann_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다")
    if not _can_edit(user, a):
        raise HTTPException(403, "본인이 작성한 공지만 수정할 수 있습니다")

    if "title" in body:
        t = (body["title"] or "").strip()
        if not t:
            raise HTTPException(400, "제목은 비울 수 없습니다")
        a.title = t[:200]
    if "body" in body:
        c = (body["body"] or "").strip()
        if not c:
            raise HTTPException(400, "본문은 비울 수 없습니다")
        a.body = c
    if "audience" in body:
        try:
            a.audience = AnnouncementAudience(body["audience"])
        except ValueError:
            raise HTTPException(400, "잘못된 audience")
    if "is_pinned" in body:
        a.is_pinned = bool(body["is_pinned"])

    await db.flush()
    await log_action(db, user, "announcement.update", f"announcement:{a.id}", request=request)
    return {"id": a.id, "title": a.title}


@router.delete("/{ann_id}")
async def delete_announcement(
    ann_id: int,
    request: Request = None,
    user: User = Depends(require_permission("announcement.post.delete")),
    db: AsyncSession = Depends(get_db),
):
    a = (await db.execute(select(Announcement).where(Announcement.id == ann_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "공지사항을 찾을 수 없습니다")
    if not _can_edit(user, a):
        raise HTTPException(403, "본인이 작성한 공지만 삭제할 수 있습니다")

    await db.delete(a)
    await db.flush()
    await log_action(db, user, "announcement.delete", f"announcement:{ann_id}", request=request)
    return {"ok": True}
