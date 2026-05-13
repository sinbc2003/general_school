"""LLM 어댑터 레지스트리 — provider별 어댑터 인스턴스 생성

DB의 LLMProvider 행에서 API 키를 복호화해 어댑터를 만들고,
프로세스 메모리에 캐시 (provider별 1개).
API 키 변경 시 invalidate_cache() 호출.
"""

from typing import Type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt
from app.models.chatbot import LLMProvider
from app.services.llm.anthropic_adapter import AnthropicAdapter
from app.services.llm.base import LLMAdapter
from app.services.llm.google_adapter import GoogleAdapter
from app.services.llm.openai_adapter import OpenAIAdapter

_ADAPTER_CLASSES: dict[str, Type[LLMAdapter]] = {
    "openai": OpenAIAdapter,
    "anthropic": AnthropicAdapter,
    "google": GoogleAdapter,
}

SUPPORTED_PROVIDERS = list(_ADAPTER_CLASSES.keys())

_cache: dict[str, LLMAdapter] = {}


async def get_adapter(db: AsyncSession, provider: str) -> LLMAdapter | None:
    """provider 어댑터 반환. 키 미등록/비활성이면 None."""
    if provider in _cache:
        return _cache[provider]

    if provider not in _ADAPTER_CLASSES:
        return None

    result = await db.execute(
        select(LLMProvider).where(LLMProvider.provider == provider)
    )
    row = result.scalar_one_or_none()
    if not row or not row.is_active or not row.api_key_encrypted:
        return None

    api_key = decrypt(row.api_key_encrypted)
    if not api_key:
        return None

    adapter = _ADAPTER_CLASSES[provider](api_key=api_key)
    _cache[provider] = adapter
    return adapter


def make_adapter(provider: str, api_key: str) -> LLMAdapter | None:
    """일회성 어댑터 (테스트용 — 캐시하지 않음)"""
    cls = _ADAPTER_CLASSES.get(provider)
    if not cls:
        return None
    return cls(api_key=api_key)


def invalidate_cache(provider: str | None = None) -> None:
    """API 키 변경/비활성화 시 호출"""
    if provider:
        _cache.pop(provider, None)
    else:
        _cache.clear()
