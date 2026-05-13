"""Google Gemini 어댑터 — google-genai SDK 스트리밍"""

from typing import AsyncIterator

from google import genai
from google.genai import types as genai_types

from app.services.llm.base import LLMAdapter, LLMChunk, LLMMessage


class GoogleAdapter(LLMAdapter):
    provider = "google"

    def __init__(self, api_key: str):
        super().__init__(api_key)
        self._client = genai.Client(api_key=api_key)

    async def chat_stream(
        self,
        model: str,
        messages: list[LLMMessage],
        system: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[LLMChunk]:
        # Gemini는 role을 "user"/"model"로 사용
        contents = []
        for m in messages:
            role = "model" if m.role == "assistant" else "user"
            contents.append(genai_types.Content(
                role=role,
                parts=[genai_types.Part.from_text(text=m.content)],
            ))

        config_kwargs: dict = {
            "max_output_tokens": max_tokens,
            "temperature": temperature,
        }
        if system:
            config_kwargs["system_instruction"] = system
        config = genai_types.GenerateContentConfig(**config_kwargs)

        try:
            input_tokens = 0
            output_tokens = 0
            stream = await self._client.aio.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )
            async for chunk in stream:
                if chunk.text:
                    yield LLMChunk(delta=chunk.text)
                # 마지막 청크에 usage_metadata가 들어있음
                if chunk.usage_metadata:
                    input_tokens = chunk.usage_metadata.prompt_token_count or 0
                    output_tokens = chunk.usage_metadata.candidates_token_count or 0
            yield LLMChunk(done=True, input_tokens=input_tokens, output_tokens=output_tokens)
        except Exception as e:
            yield LLMChunk(done=True, error=f"{type(e).__name__}: {e}")

    async def test_connection(self) -> tuple[bool, str | None]:
        try:
            # 모델 목록 조회로 인증 검증
            models = await self._client.aio.models.list()
            # 첫 페이지만 받으면 됨
            async for _ in models:
                break
            return True, None
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
