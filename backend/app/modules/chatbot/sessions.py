"""챗봇 세션 + 메시지 SSE 스트리밍 endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import sessions'로 등록.
"""

from datetime import date, datetime, timedelta
from typing import AsyncIterator
import json

from fastapi import Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import async_session_factory, get_db
from app.core.permissions import require_permission
from app.models.chatbot import (
    ChatbotConfig, ChatMessage, ChatSession, ChatUsageDaily,
    LLMModel, LLMProvider, SystemPrompt,
)
from app.models.user import User
from app.services.llm.base import LLMMessage
from app.services.llm.cost import calculate_cost_usd
from app.services.llm.registry import get_adapter, make_adapter

from app.modules.chatbot.router import (
    router,
    _audience_for,
    _get_config,
    _ensure_active_provider,
    _ensure_model_available,
)


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
