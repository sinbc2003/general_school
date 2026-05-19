"""클래스룸 단축 링크 + QR 코드 라우터.

경로:
  POST /api/classroom/links             단축 링크 생성 (target_type+id 지정)
  GET  /api/classroom/links/by-target   target_type+target_id로 기존 링크 조회
  GET  /q/{slug}/resolve                slug → target_type+target_id 조회 (익명 OK)
                                        click_count 1 증가.
  GET  /api/classroom/links/{slug}/qr.png  QR PNG (생성자/관리자만)
  GET  /api/classroom/links/{slug}/qr.svg  QR SVG (생성자/관리자만)

작동:
  - 생성: target 권한 검증 (설문 작성자/admin만 자기 설문의 링크 생성)
  - resolve: 익명 OK — slug 자체는 공개 (QR 시나리오). 단 target에 들어가서 응답하려면
             target 측에서 인증·access_mode 가드.
  - 만료 처리: expires_at 지나면 410 Gone.
"""

import io
import secrets
from datetime import datetime, timezone

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom_docs import ClassroomDocument
from app.models.classroom_links import ShortLink
from app.models.classroom_surveys import Survey
from app.models.user import User
from app.modules.classroom_links.schemas import ShortLinkCreate

router = APIRouter(prefix="/api/classroom/links", tags=["classroom-links"])

# /q/{slug} 익명 redirect는 prefix 분리
public_router = APIRouter(prefix="/q", tags=["short-link-public"])


# ── helpers ────────────────────────────────────────────────


BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"


def _gen_slug(length: int) -> str:
    return "".join(secrets.choice(BASE62) for _ in range(length))


async def _generate_unique_slug(db: AsyncSession, *, base_length: int = 6) -> str:
    """충돌 시 길이 +1 재시도. 무한 루프 방지 위해 최대 길이 16."""
    for length in range(base_length, 17):
        for _attempt in range(5):
            slug = _gen_slug(length)
            dup = (await db.execute(
                select(ShortLink.id).where(ShortLink.slug == slug)
            )).scalar_one_or_none()
            if not dup:
                return slug
    raise RuntimeError("slug 생성 실패 (16자 한도 도달)")


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


async def _assert_target_ownership(
    db: AsyncSession, user: User, target_type: str, target_id: int,
) -> None:
    """단축 링크 생성·QR 조회 권한 가드.

    - survey: author_id == user.id 또는 admin
    - document: owner_id == user.id 또는 admin
    """
    if _is_admin(user):
        return
    if target_type == "survey":
        s = await db.get(Survey, target_id)
        if not s:
            raise HTTPException(404, "설문 없음")
        if s.author_id != user.id:
            raise HTTPException(403, "본인 설문의 링크만 생성 가능")
        return
    if target_type == "document":
        d = await db.get(ClassroomDocument, target_id)
        if not d:
            raise HTTPException(404, "문서 없음")
        if d.owner_id != user.id:
            raise HTTPException(403, "본인 문서의 링크만 생성 가능")
        return
    raise HTTPException(400, f"지원하지 않는 target_type: {target_type}")


def _link_to_dict(link: ShortLink) -> dict:
    return {
        "id": link.id,
        "slug": link.slug,
        "target_type": link.target_type,
        "target_id": link.target_id,
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "expires_at": link.expires_at.isoformat() if link.expires_at else None,
        "click_count": link.click_count,
        "short_url": f"{settings.FRONTEND_URL}/q/{link.slug}",
    }


# ── 라우트 ────────────────────────────────────────────────


@router.post("")
async def create_short_link(
    body: ShortLinkCreate, request: Request,
    user: User = Depends(require_permission("classroom.link.create")),
    db: AsyncSession = Depends(get_db),
):
    await _assert_target_ownership(db, user, body.target_type, body.target_id)

    # 기존 링크가 있으면 재사용 (멱등) — 같은 target에 여러 링크 만들 필요 없음
    existing = (await db.execute(
        select(ShortLink).where(
            ShortLink.target_type == body.target_type,
            ShortLink.target_id == body.target_id,
            ShortLink.created_by_id == user.id,
        ).order_by(ShortLink.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if existing and not body.expires_at:
        # 만료 변경 요청 없으면 기존 거 그대로 반환
        return _link_to_dict(existing)

    slug = await _generate_unique_slug(db)
    link = ShortLink(
        slug=slug,
        target_type=body.target_type,
        target_id=body.target_id,
        created_by_id=user.id,
        expires_at=body.expires_at,
    )
    db.add(link)
    await db.flush()
    await log_action(
        db, user, "classroom.link.create",
        target=f"slug:{slug} {body.target_type}:{body.target_id}", request=request,
    )
    return _link_to_dict(link)


@router.get("/by-target")
async def get_link_by_target(
    target_type: str = Query(...),
    target_id: int = Query(..., gt=0),
    user: User = Depends(require_permission("classroom.link.create")),
    db: AsyncSession = Depends(get_db),
):
    """target에 연결된 본인 링크 조회 (없으면 404)."""
    await _assert_target_ownership(db, user, target_type, target_id)
    link = (await db.execute(
        select(ShortLink).where(
            ShortLink.target_type == target_type,
            ShortLink.target_id == target_id,
            ShortLink.created_by_id == user.id,
        ).order_by(ShortLink.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404)
    return _link_to_dict(link)


def _check_link_alive(link: ShortLink) -> None:
    if link.expires_at:
        now = datetime.now(timezone.utc)
        exp = link.expires_at
        # SQLite는 naive datetime을 반환 — UTC로 가정해 aware 비교 보장
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < now:
            raise HTTPException(410, "만료된 단축 링크")


@router.get("/{slug}/qr.png")
async def qr_png(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """QR 코드 PNG — 인증 사용자만 (생성자/admin)."""
    link = (await db.execute(
        select(ShortLink).where(ShortLink.slug == slug)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404)
    if not _is_admin(user) and link.created_by_id != user.id:
        raise HTTPException(403, "본인이 만든 링크의 QR만 다운로드 가능")
    _check_link_alive(link)

    short_url = f"{settings.FRONTEND_URL}/q/{slug}"
    img = qrcode.make(short_url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    filename = f"qr_{slug}.png"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{slug}/qr.svg")
async def qr_svg(
    slug: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """QR 코드 SVG."""
    link = (await db.execute(
        select(ShortLink).where(ShortLink.slug == slug)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404)
    if not _is_admin(user) and link.created_by_id != user.id:
        raise HTTPException(403)
    _check_link_alive(link)

    short_url = f"{settings.FRONTEND_URL}/q/{slug}"
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(short_url, image_factory=factory)
    buf = io.BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")


# ── 공개 resolve (익명 OK — frontend redirect 핸들러용) ──


@public_router.get("/{slug}/resolve")
async def resolve_short_link(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """slug → target_type+target_id. 익명 OK.

    click_count 1 증가. 만료 시 410. 다음 frontend가 적절한 라우트로 redirect.
    """
    link = (await db.execute(
        select(ShortLink).where(ShortLink.slug == slug)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "단축 링크를 찾을 수 없습니다")
    _check_link_alive(link)
    link.click_count += 1
    await db.flush()
    return {
        "slug": slug,
        "target_type": link.target_type,
        "target_id": link.target_id,
    }
