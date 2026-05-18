"""챗봇 관리자 — 시스템 프롬프트 관리 endpoints.

list (audience 필터) / create / update / delete + default 단일성 보호.
router 객체는 router.py에서 공유. router.py 끝의 'from . import admin_prompts'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.chatbot import SystemPrompt
from app.models.user import User

from app.modules.chatbot.router import router, _audience_for
from app.modules.chatbot.schemas import PromptCreate, PromptUpdate


async def _clear_other_defaults(db: AsyncSession, audience: str, keep_id: int):
    """동일 audience의 다른 default 프롬프트 해제 (default는 audience당 1개)."""
    others = (await db.execute(
        select(SystemPrompt).where(
            SystemPrompt.audience == audience,
            SystemPrompt.id != keep_id,
            SystemPrompt.is_default == True,
        )
    )).scalars().all()
    for o in others:
        o.is_default = False


@router.get("/prompts")
async def list_prompts(
    audience: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """audience 필터. 일반 사용자는 자기 audience + both만 노출."""
    q = select(SystemPrompt).where(SystemPrompt.is_active == True).order_by(
        SystemPrompt.audience, desc(SystemPrompt.is_default), SystemPrompt.sort_order
    )
    if audience:
        q = q.where(SystemPrompt.audience.in_([audience, "both"]))
    elif user.role not in ("super_admin", "designated_admin"):
        my = _audience_for(user)
        q = q.where(SystemPrompt.audience.in_([my, "both"]))
    rows = (await db.execute(q)).scalars().all()
    return {"items": [
        {
            "id": p.id, "name": p.name, "audience": p.audience,
            "content": p.content, "is_default": p.is_default,
            "is_active": p.is_active, "sort_order": p.sort_order,
        } for p in rows
    ]}


@router.post("/prompts")
async def create_prompt(
    body: PromptCreate, request: Request,
    user: User = Depends(require_permission("chatbot.prompt.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = SystemPrompt(
        name=body.name, audience=body.audience, content=body.content,
        is_default=body.is_default,
        is_active=True,
        sort_order=100,
        created_by=user.id,
    )
    db.add(p)
    await db.flush()
    if p.is_default:
        # 동일 audience의 다른 default 해제
        await _clear_other_defaults(db, p.audience, p.id)
    await log_action(db, user, "llm_prompt_created", target=str(p.id), request=request)
    return {"id": p.id}


@router.put("/prompts/{pid}")
async def update_prompt(
    pid: int, body: PromptUpdate, request: Request,
    user: User = Depends(require_permission("chatbot.prompt.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(SystemPrompt).where(SystemPrompt.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    patch = body.model_dump(exclude_unset=True)
    for f in ("name", "content", "audience"):
        if f in patch and patch[f] is not None:
            setattr(p, f, patch[f])
    if "is_default" in patch and patch["is_default"] is not None:
        p.is_default = patch["is_default"]
        if p.is_default:
            await _clear_other_defaults(db, p.audience, p.id)
    await log_action(db, user, "llm_prompt_updated", target=str(pid), request=request)
    return {"ok": True}


@router.delete("/prompts/{pid}")
async def delete_prompt(
    pid: int, request: Request,
    user: User = Depends(require_permission("chatbot.prompt.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(SystemPrompt).where(SystemPrompt.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    await db.delete(p)
    await log_action(db, user, "llm_prompt_deleted", target=str(pid), request=request)
    return {"ok": True}
