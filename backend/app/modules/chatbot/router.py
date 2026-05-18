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



# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.chatbot import sessions  # noqa: E402, F401
from app.modules.chatbot import admin  # noqa: E402, F401
