"""Hocuspocus 사이드카 연동 endpoint.

- GET /permission : WS auth 시 Hocuspocus가 호출
- GET /yjs-snapshot : 문서 초기 로딩 (Hocuspocus만)
- POST /yjs-snapshot : 주기 저장 (X-Internal-Token 인증)
"""

import base64

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.classroom_docs import ClassroomDocument, DocumentRevision
from app.models.user import User
from app.modules.classroom_docs._helpers import resolve_permission
from app.modules.classroom_docs.router import router
from app.modules.classroom_docs.schemas import DocumentSnapshotIn


@router.get("/{did}/permission")
async def check_doc_permission(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 서버의 WS auth 단계에서 호출."""
    d = await db.get(ClassroomDocument, did)
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
    """문서 초기 로딩 시 호출 — Hocuspocus 전용 (INTERNAL_TOKEN 인증).

    onLoadDocument 시점에는 사용자 컨텍스트가 없어 사용자 JWT로는 인증 불가.
    POST(저장)와 동일한 인증 방식 사용. 권한 가드는 onAuthenticate(WS auth) 단계에서
    이미 처리됨 (사용자별 can_read 체크).
    """
    expected_token = settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected_token:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected_token:
        raise HTTPException(401, "내부 토큰 인증 실패")

    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)

    if d.yjs_state is None:
        return {"state_base64": None, "doc_id": did}
    return {
        "state_base64": base64.b64encode(d.yjs_state).decode("ascii"),
        "doc_id": did,
    }


@router.post("/{did}/yjs-snapshot")
async def save_yjs_snapshot(
    did: int, body: DocumentSnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 전용 — INTERNAL_TOKEN 인증 (사용자 JWT 안 씀).

    1분 debounce로 호출 → Document.yjs_state 갱신 + DocumentRevision insert.
    """
    expected_token = settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected_token:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정 (서버 환경변수 확인)")
    if x_internal_token != expected_token:
        raise HTTPException(401, "내부 토큰 인증 실패")

    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)

    try:
        state = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "state_base64 디코딩 실패")

    d.yjs_state = state
    if body.plain_text is not None:
        d.plain_text = body.plain_text

    rev = DocumentRevision(
        document_id=did,
        yjs_state=state,
        plain_text=body.plain_text,
        created_by_id=body.created_by_id,
    )
    db.add(rev)
    await db.flush()
    return {"ok": True, "revision_id": rev.id, "byte_size": len(state)}
