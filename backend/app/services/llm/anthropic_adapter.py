"""Anthropic 어댑터 — Messages API 스트리밍"""

from typing import AsyncIterator

from anthropic import AsyncAnthropic

from app.services.llm.base import LLMAdapter, LLMChunk, LLMMessage


class AnthropicAdapter(LLMAdapter):
    provider = "anthropic"

    def __init__(self, api_key: str):
        super().__init__(api_key)
        self._client = AsyncAnthropic(api_key=api_key)

    async def chat_stream(
        self,
        model: str,
        messages: list[LLMMessage],
        system: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[LLMChunk]:
        msgs = [{"role": m.role, "content": m.content} for m in messages]

        try:
            kwargs: dict = {
                "model": model,
                "messages": msgs,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }
            if system:
                kwargs["system"] = system

            input_tokens = 0
            output_tokens = 0
            async with self._client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    if text:
                        yield LLMChunk(delta=text)
                final = await stream.get_final_message()
                if final.usage:
                    input_tokens = final.usage.input_tokens
                    output_tokens = final.usage.output_tokens

            yield LLMChunk(done=True, input_tokens=input_tokens, output_tokens=output_tokens)
        except Exception as e:
            yield LLMChunk(done=True, error=f"{type(e).__name__}: {e}")

    async def test_connection(self) -> tuple[bool, str | None]:
        try:
            # 가장 저렴한 모델로 1토큰 ping
            await self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1,
                messages=[{"role": "user", "content": "hi"}],
            )
            return True, None
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
