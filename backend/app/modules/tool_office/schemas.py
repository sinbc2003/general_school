"""업무 도구 요청 스키마."""

from pydantic import BaseModel, Field


class MathpixConfigBody(BaseModel):
    app_id: str = Field("", max_length=500)
    app_key: str = Field("", max_length=500)  # 빈 문자열 = 기존 키 유지
    enabled: bool = True
