"""Hocuspocus 사이드카 연동 — deck 전체 단위 Y.Doc."""

import base64

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.classroom_slides import ClassroomPresentation
from app.models.user import User
from app.modules.classroom_slides._helpers import resolve_permission
from app.modules.classroom_slides.router import router
from app.modules.classroom_slides.schemas import DeckSnapshotIn


@router.get("/{did}/permission")
async def check_deck_permission(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus WS auth 단계에서 호출."""
    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    if d.is_archived:
        perm = await resolve_permission(db, user, d)
        perm["can_write"] = False
        return perm
    return await resolve_permission(db, user, d)


@router.get("/{did}/yjs-snapshot")
async def get_yjs_snapshot(
    did: int,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 전용 — INTERNAL_TOKEN 인증.

    deck 단위 Y.Doc 1개에 모든 slide fragment 공유.
    """
    expected_token = settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected_token:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected_token:
        raise HTTPException(401, "내부 토큰 인증 실패")

    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)
    if d.yjs_state is None:
        return {"state_base64": None, "deck_id": did}
    return {
        "state_base64": base64.b64encode(d.yjs_state).decode("ascii"),
        "deck_id": did,
    }


@router.post("/{did}/yjs-snapshot")
async def save_yjs_snapshot(
    did: int, body: DeckSnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 전용 — 1분 debounce snapshot 저장.

    slide별 plain_text 추출은 향후 (현재는 deck 전체 plain_text만 검색 인덱스).
    """
    expected_token = settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected_token:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected_token:
        raise HTTPException(401, "내부 토큰 인증 실패")

    d = await db.get(ClassroomPresentation, did)
    if not d:
        raise HTTPException(404)

    try:
        state = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "state_base64 디코딩 실패")

    d.yjs_state = state
    d.storage_bytes = len(state)
    # plain_text는 deck 전체 검색용 (slide-by-slide 분리는 향후).
    await db.flush()
    return {"ok": True, "byte_size": len(state)}
