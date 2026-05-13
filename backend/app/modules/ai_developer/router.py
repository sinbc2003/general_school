"""AI 개발자 API — 피드백 → AI 코드 생성 → 관리자 승인 → 자동 적용"""

import json
import os
import signal
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_admin
from app.models.feedback import DevRequest, Feedback
from app.models.user import User
from app.modules.ai_developer.schemas import (
    DevRequestApply,
    DevRequestCreate,
    DevRequestExecute,
    DevRequestListResponse,
    DevRequestResponse,
)
from app.modules.ai_developer.service import (
    apply_changes,
    build_system_prompt,
    build_user_message,
    call_claude_api,
    extract_referenced_files,
    needs_backend_restart,
    restart_backend,
)

router = APIRouter(prefix="/api/ai-developer", tags=["ai-developer"])


@router.get("/models")
async def list_models(
    user: User = Depends(require_admin()),
):
    import httpx
    from app.core.config import settings
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY가 설정되지 않았습니다.")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
            )
            resp.raise_for_status()
            data = resp.json()
        return {"models": [
            {"id": m["id"], "display_name": m.get("display_name", m["id"])}
            for m in data.get("data", [])
        ]}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Anthropic API 호출 실패: {e}")


@router.get("", response_model=DevRequestListResponse)
async def list_requests(
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    q = select(DevRequest)
    cq = select(func.count(DevRequest.id))
    if status:
        q = q.where(DevRequest.status == status)
        cq = cq.where(DevRequest.status == status)
    total = await db.scalar(cq) or 0
    rows = (await db.execute(
        q.order_by(desc(DevRequest.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return DevRequestListResponse(total=total, items=rows)


@router.get("/{request_id}", response_model=DevRequestResponse)
async def get_request(
    request_id: int,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(DevRequest, request_id)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다.")
    return req


@router.post("", response_model=DevRequestResponse)
async def create_request(
    body: DevRequestCreate,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    if body.feedback_id:
        fb = await db.get(Feedback, body.feedback_id)
        if not fb:
            raise HTTPException(404, "피드백을 찾을 수 없습니다.")
    req = DevRequest(
        feedback_id=body.feedback_id,
        title=body.title,
        prompt=body.prompt,
        request_type=body.request_type,
        status="draft",
        created_by_id=user.id,
    )
    db.add(req)
    await db.flush()
    await db.refresh(req)
    return req


@router.post("/{request_id}/generate", response_model=DevRequestResponse)
async def generate_code(
    request_id: int,
    body: DevRequestExecute | None = None,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(DevRequest, request_id)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다.")
    if req.status not in ("draft", "failed", "rejected"):
        raise HTTPException(400, f"현재 상태({req.status})에서는 생성할 수 없습니다.")

    from app.core.config import settings
    api_key = settings.ANTHROPIC_API_KEY
    if not api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY가 설정되지 않았습니다.")

    model = (body.model if body and body.model else None) or "claude-sonnet-4-20250514"
    req.status = "generating"
    req.used_model = model
    await db.flush()

    try:
        system_prompt = build_system_prompt()
        referenced_files = extract_referenced_files(req.prompt)
        user_message = build_user_message(
            prompt=req.prompt,
            request_type=req.request_type,
            additional_context=body.additional_context if body else None,
            referenced_files=referenced_files,
        )
        result = await call_claude_api(system_prompt, user_message, api_key, model)
        req.ai_response = result.get("summary", "")
        req.file_changes = result.get("changes", [])
        req.error_message = result.get("notes")
        req.status = "generated"
    except Exception as e:
        req.status = "failed"
        req.error_message = str(e)

    await db.flush()
    await db.refresh(req)
    return req


@router.post("/{request_id}/review", response_model=DevRequestResponse)
async def review_request(
    request_id: int,
    body: DevRequestApply,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(DevRequest, request_id)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다.")
    if req.status != "generated":
        raise HTTPException(400, "생성 완료 상태에서만 리뷰할 수 있습니다.")

    if body.note:
        req.admin_note = body.note

    if body.action == "reject":
        req.status = "rejected"
        await db.flush()
        await db.refresh(req)
        return req

    # 승인 → 코드 적용
    req.status = "approved"
    await db.flush()

    try:
        changes = req.file_changes or []
        results = apply_changes(changes)
        failed = [r for r in results if r["status"] == "failed"]
        if failed:
            req.error_message = json.dumps(failed, ensure_ascii=False)
            req.status = "failed"
        else:
            req.status = "applied"
            req.error_message = None
            if needs_backend_restart(changes):
                req.admin_note = (req.admin_note or "") + "\n[시스템] 백엔드 파일 변경 — 서버 재시작 예정"
    except Exception as e:
        req.status = "failed"
        req.error_message = f"적용 중 오류: {str(e)}"

    await db.flush()
    await db.refresh(req)

    if req.status == "applied" and needs_backend_restart(changes):
        asyncio.get_event_loop().call_later(1.5, _schedule_restart)

    return req


def _schedule_restart():
    restart_backend()
    os.kill(os.getpid(), signal.SIGTERM)


@router.delete("/{request_id}")
async def delete_request(
    request_id: int,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(DevRequest, request_id)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다.")
    if req.status == "applied":
        raise HTTPException(400, "이미 적용된 요청은 삭제할 수 없습니다.")
    await db.delete(req)
    await db.flush()
    return {"detail": "삭제 완료"}
