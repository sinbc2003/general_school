"""챗봇 라우터 — 세션/메시지(SSE)/관리자 설정"""

from datetime import date, datetime, timedelta
from typing import AsyncIterator
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import async_session_factory, get_db
from app.core.encryption import decrypt, encrypt, mask_secret
from app.core.permissions import require_permission, require_super_admin
from app.models.chatbot import (
    ChatbotConfig, ChatMessage, ChatSession, ChatUsageDaily,
    LLMModel, LLMProvider, SystemPrompt,
)
from app.models.user import User
from app.services.llm.base import LLMMessage
from app.services.llm.cost import calculate_cost_usd
from app.services.llm.registry import (
    SUPPORTED_PROVIDERS, get_adapter, invalidate_cache, make_adapter,
)

router = APIRouter(prefix="/api/chatbot", tags=["chatbot"])


# ========== 헬퍼 ==========

def _audience_for(user: User) -> str:
    """사용자 role에서 audience 결정"""
    if user.role == "student":
        return "student"
    if user.role in ("teacher", "staff"):
        return "teacher"
    return "teacher"  # admin도 교사 모드 사용


async def _get_config(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(ChatbotConfig).where(ChatbotConfig.key == key))
    row = result.scalar_one_or_none()
    return row.value if row and row.value is not None else default


async def _set_config(db: AsyncSession, key: str, value: str) -> None:
    result = await db.execute(select(ChatbotConfig).where(ChatbotConfig.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(ChatbotConfig(key=key, value=value))


async def _ensure_active_provider(db: AsyncSession, provider: str) -> None:
    result = await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))
    p = result.scalar_one_or_none()
    if not p or not p.is_active or not p.api_key_encrypted:
        raise HTTPException(400, f"활성화된 provider가 아닙니다: {provider}")


async def _ensure_model_available(db: AsyncSession, provider: str, model_id: str) -> LLMModel:
    result = await db.execute(
        select(LLMModel).where(
            LLMModel.provider == provider,
            LLMModel.model_id == model_id,
            LLMModel.is_active == True,
        )
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(400, f"등록되지 않은 모델: {provider}/{model_id}")
    return m


# ========== 1. 세션 ==========

@router.get("/sessions/all")
async def list_all_sessions(
    user_id: int | None = None,
    archived: bool = False,
    limit: int = 100,
    user: User = Depends(require_permission("chatbot.session.view_all")),
    db: AsyncSession = Depends(get_db),
):
    """관리자: 전체 사용자 대화 세션 조회 (모니터링)"""
    q = select(ChatSession, User.username, User.name, User.role).join(
        User, User.id == ChatSession.user_id
    ).where(ChatSession.archived == archived)
    if user_id:
        q = q.where(ChatSession.user_id == user_id)
    q = q.order_by(desc(ChatSession.last_message_at), desc(ChatSession.created_at)).limit(limit)
    rows = (await db.execute(q)).all()
    return {
        "items": [
            {
                "id": s.id, "title": s.title, "audience": s.audience,
                "provider": s.provider, "model_id": s.model_id,
                "user_id": s.user_id, "user_username": username,
                "user_name": name, "user_role": role,
                "total_cost_usd": round(s.total_cost_usd, 6),
                "total_input_tokens": s.total_input_tokens,
                "total_output_tokens": s.total_output_tokens,
                "created_at": s.created_at.isoformat(),
                "last_message_at": s.last_message_at.isoformat() if s.last_message_at else None,
            }
            for s, username, name, role in rows
        ]
    }


@router.get("/sessions")
async def list_sessions(
    archived: bool = False,
    user: User = Depends(require_permission("chatbot.session.view_own")),
    db: AsyncSession = Depends(get_db),
):
    """내 대화 세션 목록"""
    q = select(ChatSession).where(
        ChatSession.user_id == user.id,
        ChatSession.archived == archived,
    ).order_by(desc(ChatSession.pinned), desc(ChatSession.last_message_at), desc(ChatSession.created_at))
    rows = (await db.execute(q)).scalars().all()
    return {
        "items": [
            {
                "id": s.id, "title": s.title, "audience": s.audience,
                "provider": s.provider, "model_id": s.model_id,
                "pinned": s.pinned, "archived": s.archived,
                "total_cost_usd": round(s.total_cost_usd, 6),
                "created_at": s.created_at.isoformat(),
                "last_message_at": s.last_message_at.isoformat() if s.last_message_at else None,
            }
            for s in rows
        ]
    }


@router.post("/sessions")
async def create_session(
    body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.use")),
    db: AsyncSession = Depends(get_db),
):
    """새 세션 생성. body: {provider?, model_id?, system_prompt_id?}
    값 누락 시 ChatbotConfig의 audience별 default 사용.
    """
    audience = _audience_for(user)
    default_provider = await _get_config(db, f"default_provider_{audience}", "")
    default_model = await _get_config(db, f"default_model_{audience}", "")

    provider = body.get("provider") or default_provider
    model_id = body.get("model_id") or default_model
    if not provider or not model_id:
        raise HTTPException(400, "provider/model이 설정되지 않았습니다. 관리자에게 문의하세요.")

    await _ensure_active_provider(db, provider)
    await _ensure_model_available(db, provider, model_id)

    system_prompt_id = body.get("system_prompt_id")
    if system_prompt_id:
        sp = (await db.execute(
            select(SystemPrompt).where(SystemPrompt.id == system_prompt_id, SystemPrompt.is_active == True)
        )).scalar_one_or_none()
        if not sp:
            raise HTTPException(400, "유효하지 않은 시스템 프롬프트")
        if sp.audience not in ("both", audience):
            raise HTTPException(403, "사용 가능한 시스템 프롬프트가 아닙니다")
    else:
        # audience별 기본 프롬프트
        sp_default = (await db.execute(
            select(SystemPrompt).where(
                SystemPrompt.is_default == True,
                SystemPrompt.is_active == True,
                SystemPrompt.audience.in_(["both", audience]),
            ).order_by(SystemPrompt.sort_order)
        )).scalar_one_or_none()
        system_prompt_id = sp_default.id if sp_default else None

    s = ChatSession(
        user_id=user.id, title=body.get("title") or "새 대화",
        audience=audience, provider=provider, model_id=model_id,
        system_prompt_id=system_prompt_id,
    )
    db.add(s)
    await db.flush()
    await log_action(db, user, "chat_session_created", target=str(s.id), request=request)
    return {"id": s.id, "title": s.title, "provider": provider, "model_id": model_id,
            "system_prompt_id": system_prompt_id}


@router.get("/sessions/{sid}")
async def get_session(
    sid: int,
    user: User = Depends(require_permission("chatbot.session.view_own")),
    db: AsyncSession = Depends(get_db),
):
    s = (await db.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one_or_none()
    if not s:
        raise HTTPException(404)
    if s.user_id != user.id and user.role not in ("super_admin", "designated_admin"):
        raise HTTPException(403)

    msgs = (await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == sid).order_by(ChatMessage.created_at)
    )).scalars().all()

    return {
        "id": s.id, "title": s.title, "audience": s.audience,
        "provider": s.provider, "model_id": s.model_id,
        "system_prompt_id": s.system_prompt_id,
        "pinned": s.pinned, "archived": s.archived,
        "total_input_tokens": s.total_input_tokens,
        "total_output_tokens": s.total_output_tokens,
        "total_cost_usd": round(s.total_cost_usd, 6),
        "messages": [
            {
                "id": m.id, "role": m.role, "content": m.content,
                "provider": m.provider, "model_id": m.model_id,
                "input_tokens": m.input_tokens, "output_tokens": m.output_tokens,
                "cost_usd": round(m.cost_usd, 6), "error": m.error,
                "created_at": m.created_at.isoformat(),
            } for m in msgs
        ],
    }


@router.patch("/sessions/{sid}")
async def update_session(
    sid: int, body: dict,
    user: User = Depends(require_permission("chatbot.session.view_own")),
    db: AsyncSession = Depends(get_db),
):
    """제목 변경 / pinned 토글 / 모델 변경"""
    s = (await db.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one_or_none()
    if not s or s.user_id != user.id:
        raise HTTPException(404)

    if "title" in body:
        s.title = body["title"][:300]
    if "pinned" in body:
        s.pinned = bool(body["pinned"])
    if "archived" in body:
        s.archived = bool(body["archived"])

    if "provider" in body or "model_id" in body:
        new_provider = body.get("provider", s.provider)
        new_model = body.get("model_id", s.model_id)
        await _ensure_active_provider(db, new_provider)
        await _ensure_model_available(db, new_provider, new_model)
        s.provider = new_provider
        s.model_id = new_model

    if "system_prompt_id" in body:
        s.system_prompt_id = body["system_prompt_id"]

    return {"ok": True}


@router.delete("/sessions/{sid}")
async def delete_session(
    sid: int, request: Request,
    user: User = Depends(require_permission("chatbot.session.delete_own")),
    db: AsyncSession = Depends(get_db),
):
    """세션 영구 삭제 (메시지도 cascade)"""
    s = (await db.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one_or_none()
    if not s or s.user_id != user.id:
        raise HTTPException(404)
    await db.delete(s)
    await log_action(db, user, "chat_session_deleted", target=str(sid), request=request)
    return {"ok": True}


# ========== 2. 메시지 (SSE 스트리밍) ==========

async def _stream_response(sid: int, content: str, user_id: int) -> AsyncIterator[str]:
    """SSE 스트림 — 새 DB 세션을 안에서 만들어 fastapi dependency와 분리"""
    async with async_session_factory() as db:
        s = (await db.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one_or_none()
        if not s or s.user_id != user_id:
            yield f"data: {json.dumps({'error': '세션을 찾을 수 없습니다'})}\n\n"
            return

        max_len = int(await _get_config(db, "max_message_length", "8000"))
        max_msgs = int(await _get_config(db, "max_session_messages", "200"))
        if len(content) > max_len:
            yield f"data: {json.dumps({'error': f'메시지가 너무 깁니다 ({max_len}자 이하)'})}\n\n"
            return

        msg_count = (await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.session_id == sid)
        )).scalar() or 0
        if msg_count >= max_msgs:
            yield f"data: {json.dumps({'error': f'세션의 최대 메시지 수({max_msgs})를 초과했습니다. 새 대화를 시작하세요.'})}\n\n"
            return

        # 사용자 메시지 저장
        user_msg = ChatMessage(session_id=sid, role="user", content=content)
        db.add(user_msg)
        await db.flush()
        yield f"data: {json.dumps({'type': 'user_msg_id', 'id': user_msg.id})}\n\n"

        # 시스템 프롬프트 + 이전 메시지 로드
        system_text = None
        if s.system_prompt_id:
            sp = (await db.execute(
                select(SystemPrompt).where(SystemPrompt.id == s.system_prompt_id)
            )).scalar_one_or_none()
            if sp:
                system_text = sp.content

        prev = (await db.execute(
            select(ChatMessage).where(ChatMessage.session_id == sid)
            .order_by(ChatMessage.created_at)
        )).scalars().all()
        history = [LLMMessage(role=m.role, content=m.content) for m in prev if m.role in ("user", "assistant")]

        # 어댑터 호출
        adapter = await get_adapter(db, s.provider)
        if not adapter:
            err = "활성 provider가 없습니다. 관리자가 API 키를 등록해야 합니다."
            assistant_msg = ChatMessage(
                session_id=sid, role="assistant", content="",
                provider=s.provider, model_id=s.model_id, error=err,
            )
            db.add(assistant_msg)
            await db.commit()
            yield f"data: {json.dumps({'type': 'error', 'message': err})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # 응답 메시지 누적
        full_text = ""
        input_tokens = 0
        output_tokens = 0
        error_text = None

        try:
            async for chunk in adapter.chat_stream(
                model=s.model_id, messages=history, system=system_text,
            ):
                if chunk.error:
                    error_text = chunk.error
                if chunk.delta:
                    full_text += chunk.delta
                    yield f"data: {json.dumps({'type': 'delta', 'text': chunk.delta})}\n\n"
                if chunk.done:
                    input_tokens = chunk.input_tokens
                    output_tokens = chunk.output_tokens
        except Exception as e:
            error_text = f"{type(e).__name__}: {e}"

        # 비용 계산
        cost = await calculate_cost_usd(db, s.provider, s.model_id, input_tokens, output_tokens)

        # assistant 메시지 저장
        assistant_msg = ChatMessage(
            session_id=sid, role="assistant", content=full_text,
            provider=s.provider, model_id=s.model_id,
            input_tokens=input_tokens, output_tokens=output_tokens,
            cost_usd=cost, error=error_text,
        )
        db.add(assistant_msg)

        # 세션 누적 갱신
        s.total_input_tokens += input_tokens
        s.total_output_tokens += output_tokens
        s.total_cost_usd += cost
        s.last_message_at = datetime.utcnow()

        # 자동 제목 생성 (첫 user msg 기준)
        if s.title == "새 대화" and content:
            s.title = (content[:60] + "...") if len(content) > 60 else content

        # 일별 집계
        today = date.today()
        existing_usage = (await db.execute(
            select(ChatUsageDaily).where(
                ChatUsageDaily.user_id == user_id,
                ChatUsageDaily.usage_date == today,
                ChatUsageDaily.provider == s.provider,
                ChatUsageDaily.model_id == s.model_id,
            )
        )).scalar_one_or_none()
        if existing_usage:
            existing_usage.input_tokens += input_tokens
            existing_usage.output_tokens += output_tokens
            existing_usage.cost_usd += cost
            existing_usage.message_count += 1
        else:
            db.add(ChatUsageDaily(
                user_id=user_id, usage_date=today,
                provider=s.provider, model_id=s.model_id,
                input_tokens=input_tokens, output_tokens=output_tokens,
                cost_usd=cost, message_count=1,
            ))

        await db.commit()

        yield f"data: {json.dumps({'type': 'done', 'assistant_msg_id': assistant_msg.id, 'input_tokens': input_tokens, 'output_tokens': output_tokens, 'cost_usd': round(cost, 6), 'error': error_text})}\n\n"
        yield "data: [DONE]\n\n"


@router.post("/sessions/{sid}/stream")
async def stream_message(
    sid: int, body: dict,
    user: User = Depends(require_permission("chatbot.use")),
):
    """SSE 스트림 — body: {content: str}"""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(400, "내용이 비었습니다")
    return StreamingResponse(
        _stream_response(sid, content, user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ========== 3. Provider 관리 (관리자) ==========

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
    provider: str, body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    """body: {api_key?, is_active?, notes?}
    api_key가 빈 문자열/null이면 변경 안 함. is_active는 명시적으로 보낼 때만 변경.
    """
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"지원하지 않는 provider: {provider}")

    p = (await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))).scalar_one_or_none()
    if not p:
        p = LLMProvider(provider=provider)
        db.add(p)

    if body.get("api_key"):
        p.api_key_encrypted = encrypt(body["api_key"].strip())
        p.last_tested_at = None
        p.last_test_ok = False
        p.last_test_error = None
    if "is_active" in body:
        p.is_active = bool(body["is_active"])
    if "notes" in body:
        p.notes = body["notes"]

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
    body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    if body.get("provider") not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, "지원하지 않는 provider")
    m = LLMModel(
        provider=body["provider"], model_id=body["model_id"],
        display_name=body.get("display_name") or body["model_id"],
        input_per_1m_usd=float(body.get("input_per_1m_usd", 0)),
        output_per_1m_usd=float(body.get("output_per_1m_usd", 0)),
        context_window=body.get("context_window"),
        is_active=bool(body.get("is_active", True)),
        sort_order=int(body.get("sort_order", 100)),
        notes=body.get("notes"),
    )
    db.add(m)
    await db.flush()
    await log_action(db, user, "llm_model_created", target=f"{m.provider}/{m.model_id}", request=request)
    return {"id": m.id}


@router.put("/models/{mid}")
async def update_model(
    mid: int, body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.model.manage")),
    db: AsyncSession = Depends(get_db),
):
    m = (await db.execute(select(LLMModel).where(LLMModel.id == mid))).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    for f in ("display_name", "input_per_1m_usd", "output_per_1m_usd",
              "context_window", "is_active", "sort_order", "notes"):
        if f in body:
            setattr(m, f, body[f])
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
    body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.prompt.manage")),
    db: AsyncSession = Depends(get_db),
):
    if body.get("audience") not in ("teacher", "student", "both"):
        raise HTTPException(400, "audience는 teacher|student|both")
    p = SystemPrompt(
        name=body["name"], audience=body["audience"], content=body["content"],
        is_default=bool(body.get("is_default", False)),
        is_active=bool(body.get("is_active", True)),
        sort_order=int(body.get("sort_order", 100)),
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
    pid: int, body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.prompt.manage")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(SystemPrompt).where(SystemPrompt.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    for f in ("name", "content", "audience", "is_active", "sort_order"):
        if f in body:
            setattr(p, f, body[f])
    if "is_default" in body:
        p.is_default = bool(body["is_default"])
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
