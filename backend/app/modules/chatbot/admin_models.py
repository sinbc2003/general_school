"""챗봇 관리자 — LLM 모델/단가 관리 endpoints.

list / list_all (관리자 비활성 포함) / create / update / delete.
router 객체는 router.py에서 공유. router.py 끝의 'from . import admin_models'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.chatbot import LLMModel, LLMProvider
from app.models.user import User
from app.services.llm.registry import SUPPORTED_PROVIDERS

from app.modules.chatbot.router import router
from app.modules.chatbot.schemas import ModelCreate, ModelUpdate


@router.get("/models")
async def list_models(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """활성 provider의 활성 모델 목록 (모든 사용자 접근 — 챗봇 picker용)"""
    # 활성 provider만 필터
    active_providers = (await db.execute(
        select(LLMProvider.provider).where(LLMProvider.is_active == True)
    )).scalars().all()

    rows = (await db.execute(
        select(LLMModel).where(LLMModel.is_active == True).order_by(LLMModel.provider, LLMModel.sort_order)
    )).scalars().all()
    return {
        "items": [
            {
                "id": m.id, "provider": m.provider, "model_id": m.model_id,
                "display_name": m.display_name,
                "input_per_1m_usd": m.input_per_1m_usd,
                "output_per_1m_usd": m.output_per_1m_usd,
                "context_window": m.context_window,
                "active": m.provider in active_providers,
            }
            for m in rows
        ],
        "active_providers": list(active_providers),
    }


@router.get("/models/all")
async def list_all_models(
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    """관리자: 비활성 포함 전체 모델"""
    rows = (await db.execute(
        select(LLMModel).order_by(LLMModel.provider, LLMModel.sort_order)
    )).scalars().all()
    return {"items": [
        {
            "id": m.id, "provider": m.provider, "model_id": m.model_id,
            "display_name": m.display_name,
            "input_per_1m_usd": m.input_per_1m_usd,
            "output_per_1m_usd": m.output_per_1m_usd,
            "context_window": m.context_window,
            "is_active": m.is_active, "sort_order": m.sort_order,
            "notes": m.notes,
        } for m in rows
    ]}


@router.post("/models")
async def create_model(
    body: ModelCreate, request: Request,
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    if body.provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, "지원하지 않는 provider")
    m = LLMModel(
        provider=body.provider, model_id=body.model_id,
        display_name=body.display_name or body.model_id,
        input_per_1m_usd=body.input_price_per_1m_usd or 0.0,
        output_per_1m_usd=body.output_price_per_1m_usd or 0.0,
        context_window=body.context_window,
        is_active=body.is_active,
        sort_order=body.sort_order,
    )
    db.add(m)
    await db.flush()
    await log_action(db, user, "llm_model_created", target=f"{m.provider}/{m.model_id}", request=request)
    return {"id": m.id}


@router.put("/models/{mid}")
async def update_model(
    mid: int, body: ModelUpdate, request: Request,
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(LLMModel).where(LLMModel.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    patch = body.model_dump(exclude_unset=True)
    # schema 필드명 → 모델 필드명 매핑
    field_map = {
        "input_price_per_1m_usd": "input_per_1m_usd",
        "output_price_per_1m_usd": "output_per_1m_usd",
    }
    for k, v in patch.items():
        target = field_map.get(k, k)
        if hasattr(m, target):
            setattr(m, target, v)
    await log_action(db, user, "llm_model_updated", target=str(mid), request=request)
    return {"ok": True}


@router.delete("/models/{mid}")
async def delete_model(
    mid: int, request: Request,
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(LLMModel).where(LLMModel.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await log_action(db, user, "llm_model_deleted", target=str(mid), request=request)
    return {"ok": True}
