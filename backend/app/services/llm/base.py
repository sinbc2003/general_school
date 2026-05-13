"""LLM 어댑터 공통 인터페이스

3사 SDK 차이를 흡수하는 ABC.
스트리밍 청크는 표준 타입(LLMChunk)으로 yield.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class LLMMessage:
    """API에 보낼 메시지 (system은 별도 파라미터로 분리)"""
    role: str  # "user" | "assistant"
    content: str


@dataclass
class LLMChunk:
    """스트리밍 청크 — 3사 표준화"""
    delta: str = ""  # 새로 도착한 토큰 텍스트
    done: bool = False  # 마지막 청크면 True
    input_tokens: int = 0  # done=True일 때만 채워짐
    output_tokens: int = 0
    error: str | None = None


class LLMAdapter(ABC):
    """provider별 어댑터가 구현할 인터페이스"""

    provider: str = ""

    def __init__(self, api_key: str):
        self.api_key = api_key

    @abstractmethod
    async def chat_stream(
        self,
        model: str,
        messages: list[LLMMessage],
        system: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> AsyncIterator[LLMChunk]:
        """대화 스트리밍 — 청크 단위 yield. 마지막 청크는 done=True + 토큰 카운트."""
        ...

    @abstractmethod
    async def test_connection(self) -> tuple[bool, str | None]:
        """API 키 유효성 핸드셰이크. (성공여부, 에러메시지)"""
        ...
