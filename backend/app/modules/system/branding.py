"""사이트 브랜딩 endpoints — 탭 제목, 학교명, 파비콘.

Setting 테이블 키:
  site.title          : 브라우저 탭 제목 (기본 "학교 통합 플랫폼")
  site.school_name    : 사이드바/UI에 표시되는 학교 이름
  site.favicon_url    : 파비콘 URL (예: "/storage/branding/favicon.png"). 미설정 시 null

router 객체는 router.py에서 공유. router.py 끝의 'from . import branding'으로 등록.
"""

import os
from pathlib import Path

from fastapi import Depends, File, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_super_admin
from app.models.setting import Setting
from app.models.user import User
from app.modules.system.schemas import BrandingUpdate

from app.modules.system.router import router


# settings.STORAGE_ROOT 기반 (Phase 2-Q 통합).
from app.core.files import DEFAULT_STORAGE_ROOT
BRANDING_DIR = DEFAULT_STORAGE_ROOT / "branding"
ALLOWED_FAVICON_EXTS = {".ico", ".png", ".svg", ".jpg", ".jpeg"}


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return row.value if row and row.value is not None else default


async def _set_setting(db: AsyncSession, key: str, value: str | None) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


_FAVICON_MEDIA = {
    ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
}


def _find_favicon_file() -> Path | None:
    """업로드 디렉토리에서 favicon.* 파일 1개 탐색 (없으면 None)."""
    if not BRANDING_DIR.exists():
        return None
    for p in sorted(BRANDING_DIR.glob("favicon.*")):
        if p.suffix.lower() in ALLOWED_FAVICON_EXTS:
            return p
    return None


@router.get("/branding")
async def get_branding(db: AsyncSession = Depends(get_db)):
    """사이트 브랜딩 조회 — 인증 불필요 (layout metadata에서 SSR 시 호출)"""
    return {
        "title": await _get_setting(db, "site.title", settings.SCHOOL_NAME or "학교 통합 플랫폼"),
        "school_name": await _get_setting(db, "site.school_name", settings.SCHOOL_NAME or "학교"),
        "favicon_url": await _get_setting(db, "site.favicon_url", "") or None,
    }


@router.get("/branding/favicon")
async def serve_favicon():
    """파비콘 파일 서빙 — 익명(SSR·브라우저 탭 아이콘).

    /storage가 아닌 /api 경로로 서빙 → nginx가 이미 /api를 백엔드로 프록시하므로
    별도 정적 라우트·경로 매핑 없이 동작. 업로드 디렉토리(DEFAULT_STORAGE_ROOT/branding)에서 직접 읽음.
    """
    p = _find_favicon_file()
    if not p:
        return Response(status_code=404)
    media = _FAVICON_MEDIA.get(p.suffix.lower(), "application/octet-stream")
    return FileResponse(
        str(p), media_type=media,
        headers={"Cache-Control": "public, max-age=300"},
    )


@router.put("/branding")
async def update_branding(
    body: BrandingUpdate,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """사이트 브랜딩 텍스트 저장 (최고관리자 전용)"""
    patch = body.model_dump(exclude_unset=True)
    if "title" in patch:
        await _set_setting(db, "site.title", (patch["title"] or "").strip()[:200])
    if "school_name" in patch:
        await _set_setting(db, "site.school_name", (patch["school_name"] or "").strip()[:200])
    await db.flush()
    return {"ok": True}


@router.post("/branding/favicon")
async def upload_favicon(
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """파비콘 업로드 (최고관리자 전용). 기존 파일 덮어씀.
    허용 확장자: .ico, .png, .svg, .jpg, .jpeg / 최대 1MB.
    """
    from app.core.upload import validate_upload, POLICY_FAVICON
    data = await validate_upload(file, POLICY_FAVICON)
    ext = os.path.splitext(file.filename or "")[1].lower()

    from app.core.files import ensure_dir_async, write_bytes_async
    import asyncio
    await ensure_dir_async(BRANDING_DIR)
    # 동일 prefix의 기존 파일 정리 (확장자 다른 경우) — 동기 IO이지만 한 번에 처리
    def _cleanup():
        for old in BRANDING_DIR.glob("favicon.*"):
            try:
                old.unlink()
            except OSError:
                pass
    await asyncio.to_thread(_cleanup)

    target = BRANDING_DIR / f"favicon{ext}"
    await write_bytes_async(target, data)

    # cache-busting을 위한 timestamp 쿼리. /api 경로로 서빙(nginx가 /api 프록시).
    import time
    url = f"/api/system/branding/favicon?v={int(time.time())}"
    await _set_setting(db, "site.favicon_url", url)
    await db.flush()
    return {"ok": True, "favicon_url": url}


@router.delete("/branding/favicon")
async def delete_favicon(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """파비콘 제거 (기본값으로 복원)"""
    for old in BRANDING_DIR.glob("favicon.*"):
        try:
            old.unlink()
        except OSError:
            pass
    await _set_setting(db, "site.favicon_url", "")
    await db.flush()
    return {"ok": True}
