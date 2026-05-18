"""챗봇 관리자 endpoints — providers, models, prompts, config, usage.

router 객체는 router.py에서 공유. router.py 끝의 'from . import admin'으로 등록.
"""

from datetime import date, datetime, timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.encryption import decrypt, encrypt, mask_secret
from app.core.permissions import require_permission, require_super_admin
from app.models.chatbot import (
    ChatbotConfig, ChatUsageDaily, LLMModel, LLMProvider, SystemPrompt,
)
from app.models.user import User
from app.services.llm.registry import (
    SUPPORTED_PROVIDERS, invalidate_cache, make_adapter,
)

from app.modules.chatbot.router import router, _get_config, _set_config
from app.modules.chatbot.schemas import (
    ModelCreate, ModelUpdate, PromptCreate, PromptUpdate, ProviderUpsert,
)


@router.get("/providers")
async def list_providers(
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(LLMProvider).order_by(LLMProvider.provider))).scalars().all()
    existing = {r.provider for r in rows}
    items = []
    for r in rows:
        api_key_plain = decrypt(r.api_key_encrypted) if r.api_key_encrypted else ""
        items.append({
            "provider": r.provider,
            "is_active": r.is_active,
            "api_key_masked": mask_secret(api_key_plain) if api_key_plain else "",
            "has_key": bool(api_key_plain),
            "last_tested_at": r.last_tested_at.isoformat() if r.last_tested_at else None,
            "last_test_ok": r.last_test_ok,
            "last_test_error": r.last_test_error,
            "notes": r.notes,
        })
    # 미등록 provider도 placeholder로 노출
    for p in SUPPORTED_PROVIDERS:
        if p not in existing:
            items.append({
                "provider": p, "is_active": False, "api_key_masked": "",
                "has_key": False, "last_tested_at": None, "last_test_ok": False,
                "last_test_error": None, "notes": None,
            })
    items.sort(key=lambda x: SUPPORTED_PROVIDERS.index(x["provider"]) if x["provider"] in SUPPORTED_PROVIDERS else 99)
    return {"items": items, "supported": SUPPORTED_PROVIDERS}


@router.put("/providers/{provider}")
async def upsert_provider(
    provider: str, body: ProviderUpsert, request: Request,
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    """provider 키·활성 상태 부분 업데이트. api_key가 None/빈 문자열이면 변경 안 함."""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"지원하지 않는 provider: {provider}")

    p = (await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))).scalar_one_or_none()
    if not p:
        p = LLMProvider(provider=provider)
        db.add(p)

    patch = body.model_dump(exclude_unset=True)
    if patch.get("api_key"):
        p.api_key_encrypted = encrypt(patch["api_key"].strip())
        p.last_tested_at = None
        p.last_test_ok = False
        p.last_test_error = None
    if "is_active" in patch:
        p.is_active = bool(patch["is_active"])
    if "notes" in patch:
        p.notes = patch["notes"]
    if "default_model_id" in patch and hasattr(p, "default_model_id"):
        p.default_model_id = patch["default_model_id"]

    await db.flush()
    invalidate_cache(provider)
    await log_action(db, user, "llm_provider_updated", target=provider, request=request)
    return {"ok": True}


@router.post("/providers/{provider}/test")
async def test_provider(
    provider: str,
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    """저장된 키로 핸드셰이크 테스트"""
    p = (await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))).scalar_one_or_none()
    if not p or not p.api_key_encrypted:
        raise HTTPException(400, "API 키가 등록되지 않았습니다")
    api_key = decrypt(p.api_key_encrypted)
    adapter = make_adapter(provider, api_key)
    if not adapter:
        raise HTTPException(500, "어댑터 생성 실패")
    ok, err = await adapter.test_connection()
    p.last_tested_at = datetime.utcnow()
    p.last_test_ok = ok
    p.last_test_error = err
    return {"ok": ok, "error": err}


# ========== 4. 모델/단가 관리 ==========

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


# ========== 5. 시스템 프롬프트 ==========

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


async def _clear_other_defaults(db: AsyncSession, audience: str, keep_id: int):
    others = (await db.execute(
        select(SystemPrompt).where(
            SystemPrompt.audience == audience,
            SystemPrompt.id != keep_id,
            SystemPrompt.is_default == True,
        )
    )).scalars().all()
    for o in others:
        o.is_default = False


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


# ========== 6. 챗봇 전역 설정 (기본 모델 등) ==========

CONFIG_KEYS = [
    "default_provider_teacher", "default_model_teacher",
    "default_provider_student", "default_model_student",
    "student_can_change_model", "teacher_can_change_model",
    "student_can_pick_prompt", "max_message_length", "max_session_messages",
]


@router.get("/config")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """모든 사용자가 자기 audience 관련 설정 조회 가능 (기본 모델 등)"""
    rows = (await db.execute(select(ChatbotConfig))).scalars().all()
    cfg = {r.key: r.value for r in rows}
    # 기본값 채우기
    defaults = {
        "default_provider_teacher": "anthropic",
        "default_model_teacher": "claude-sonnet-4-6",
        "default_provider_student": "anthropic",
        "default_model_student": "claude-haiku-4-5-20251001",
        "student_can_change_model": "false",
        "teacher_can_change_model": "true",
        "student_can_pick_prompt": "false",
        "max_message_length": "8000",
        "max_session_messages": "200",
    }
    for k, v in defaults.items():
        cfg.setdefault(k, v)
    return cfg


@router.put("/config")
async def update_config(
    body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.config.manage")),
    db: AsyncSession = Depends(get_db),
):
    for k, v in body.items():
        if k not in CONFIG_KEYS:
            continue
        await _set_config(db, k, str(v) if v is not None else "")
    await log_action(db, user, "chatbot_config_updated", target=",".join(body.keys()), request=request)
    return {"ok": True}


# ========== 7. 사용량/비용 ==========

@router.get("/usage/me")
async def my_usage(
    days: int = 30,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """내 최근 N일 사용량"""
    since = date.today() - timedelta(days=days)
    rows = (await db.execute(
        select(ChatUsageDaily).where(
            ChatUsageDaily.user_id == user.id,
            ChatUsageDaily.usage_date >= since,
        ).order_by(ChatUsageDaily.usage_date)
    )).scalars().all()

    total_cost = sum(r.cost_usd for r in rows)
    total_messages = sum(r.message_count for r in rows)
    return {
        "days": days, "total_cost_usd": round(total_cost, 4),
        "total_messages": total_messages,
        "by_day": [
            {
                "date": r.usage_date.isoformat(), "provider": r.provider, "model_id": r.model_id,
                "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
                "cost_usd": round(r.cost_usd, 6), "message_count": r.message_count,
            } for r in rows
        ],
    }


@router.get("/usage/all")
async def all_usage(
    days: int = 30,
    user: User = Depends(require_permission("chatbot.usage.view_all")),
    db: AsyncSession = Depends(get_db),
):
    """관리자: 전체 사용량 (사용자별/일별/모델별 그룹)"""
    since = date.today() - timedelta(days=days)

    # 일별 집계
    by_day_q = await db.execute(
        select(
            ChatUsageDaily.usage_date,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.usage_date)
        .order_by(ChatUsageDaily.usage_date)
    )
    by_day = [{"date": r[0].isoformat(), "cost_usd": round(r[1] or 0, 4), "messages": r[2] or 0}
              for r in by_day_q.all()]

    # 모델별
    by_model_q = await db.execute(
        select(
            ChatUsageDaily.provider, ChatUsageDaily.model_id,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.input_tokens).label("input"),
            func.sum(ChatUsageDaily.output_tokens).label("output"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.provider, ChatUsageDaily.model_id)
    )
    by_model = [{
        "provider": r[0], "model_id": r[1], "cost_usd": round(r[2] or 0, 4),
        "input_tokens": r[3] or 0, "output_tokens": r[4] or 0, "messages": r[5] or 0,
    } for r in by_model_q.all()]

    # 사용자별 top
    by_user_q = await db.execute(
        select(
            ChatUsageDaily.user_id, User.username, User.name,
            func.sum(ChatUsageDaily.cost_usd).label("cost"),
            func.sum(ChatUsageDaily.message_count).label("messages"),
        ).join(User, User.id == ChatUsageDaily.user_id)
        .where(ChatUsageDaily.usage_date >= since)
        .group_by(ChatUsageDaily.user_id, User.username, User.name)
        .order_by(desc(func.sum(ChatUsageDaily.cost_usd)))
        .limit(50)
    )
    by_user = [{
        "user_id": r[0], "username": r[1], "name": r[2],
        "cost_usd": round(r[3] or 0, 4), "messages": r[4] or 0,
    } for r in by_user_q.all()]

    total_cost = sum(d["cost_usd"] for d in by_day)
    total_messages = sum(d["messages"] for d in by_day)
    return {
        "days": days,
        "total_cost_usd": round(total_cost, 4),
        "total_messages": total_messages,
        "by_day": by_day, "by_model": by_model, "by_user": by_user,
    }
