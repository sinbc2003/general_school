"""플랫폼 LLM(챗봇 인프라) 재사용 — 1-shot 텍스트 완성 헬퍼.

챗봇과 동일한 provider/model(ChatbotConfig 기본값) + 동일한 어댑터/키 복호화
(registry.get_adapter 가 Fernet 복호화까지 내부 처리)를 재사용한다.
스트리밍이 아니라 전체 텍스트를 모아서 반환한다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chatbot import ChatbotConfig
from app.services.llm.base import LLMMessage
from app.services.llm.registry import get_adapter


class LLMUnavailable(Exception):
    """활성 provider 없음 / 모델 미설정 / provider API 오류."""


async def _get_cfg(db: AsyncSession, key: str, default: str = "") -> str:
    row = (
        await db.execute(select(ChatbotConfig).where(ChatbotConfig.key == key))
    ).scalar_one_or_none()
    return row.value if row and row.value is not None else default


async def resolve_default_model(db: AsyncSession) -> tuple[str, str]:
    """교사 기본 provider/model 반환 (없으면 보수적 디폴트)."""
    provider = await _get_cfg(db, "default_provider_teacher", "anthropic")
    model_id = await _get_cfg(db, "default_model_teacher", "claude-sonnet-4-6")
    return provider, model_id


async def llm_available(db: AsyncSession) -> bool:
    provider, model_id = await resolve_default_model(db)
    if not provider or not model_id:
        return False
    return (await get_adapter(db, provider)) is not None


async def llm_complete(
    db: AsyncSession,
    system: str,
    user_text: str,
    max_tokens: int = 8192,
    temperature: float = 0.2,
) -> str:
    """1-shot 완성. 실패 시 LLMUnavailable."""
    provider, model_id = await resolve_default_model(db)
    if not provider or not model_id:
        raise LLMUnavailable("기본 provider/model이 설정되지 않았습니다.")

    adapter = await get_adapter(db, provider)
    if not adapter:
        raise LLMUnavailable(
            f"활성 LLM provider가 없습니다 ({provider}). "
            f"관리자가 /system/llm/providers 에서 API 키를 등록·활성화해야 합니다."
        )

    messages = [LLMMessage(role="user", content=user_text)]
    full_text = ""
    error_text: str | None = None
    try:
        async for chunk in adapter.chat_stream(
            model=model_id,
            messages=messages,
            system=system or None,
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            if chunk.error:
                error_text = chunk.error
            if chunk.delta:
                full_text += chunk.delta
    except Exception as exc:  # noqa: BLE001 — 어댑터가 못 잡은 예외 방어
        raise LLMUnavailable(str(exc)) from exc

    if error_text:
        raise LLMUnavailable(error_text)
    return full_text
