"""OpenAI 어댑터 — Chat Completions 스트리밍"""

from typing import AsyncIterator

from openai import AsyncOpenAI

from app.services.llm.base import LLMAdapter, LLMChunk, LLMMessage


class OpenAIAdapter(LLMAdapter):
    provider = "openai"

    def __init__(self, api_key: str):
        super().__init__(api_key)
        self._client = AsyncOpenAI(api_key=api_key)

    async def chat_stream(
        self,
        model: str,
        messages: list[LLMMessage],
        system: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[LLMChunk]:
        msgs = []
        if system:
            msgs.append({"role": "system", "content": system})
        for m in messages:
            msgs.append({"role": m.role, "content": m.content})

        try:
            stream = await self._client.chat.completions.create(
                model=model,
                messages=msgs,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
                stream_options={"include_usage": True},
            )
            input_tokens = 0
            output_tokens = 0
            async for chunk in stream:
                # 사용량은 마지막 청크에만 들어옴
                if chunk.usage:
                    input_tokens = chunk.usage.prompt_tokens or 0
                    output_tokens = chunk.usage.completion_tokens or 0
                if chunk.choices:
                    delta_text = chunk.choices[0].delta.content or ""
                    if delta_text:
                        yield LLMChunk(delta=delta_text)
            yield LLMChunk(done=True, input_tokens=input_tokens, output_tokens=output_tokens)
        except Exception as e:
            yield LLMChunk(done=True, error=f"{type(e).__name__}: {e}")

    async def test_connection(self) -> tuple[bool, str | None]:
        try:
            # 모델 목록 조회 — 가장 가벼운 인증 검증
            await self._client.models.list()
            return True, None
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
