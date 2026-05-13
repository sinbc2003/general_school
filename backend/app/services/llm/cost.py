"""토큰 → USD 비용 계산"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.chatbot import LLMModel


async def calculate_cost_usd(
    db: AsyncSession, provider: str, model_id: str,
    input_tokens: int, output_tokens: int,
) -> float:
    """LLMModel의 단가로 비용 계산. 모델 미등록 시 0.0."""
    result = await db.execute(
        select(LLMModel).where(
            LLMModel.provider == provider,
            LLMModel.model_id == model_id,
        )
    )
    m = result.scalar_one_or_none()
    if not m:
        return 0.0
    return (
        (input_tokens / 1_000_000) * m.input_per_1m_usd
        + (output_tokens / 1_000_000) * m.output_per_1m_usd
    )
