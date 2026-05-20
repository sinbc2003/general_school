"""부서 schemas."""

from pydantic import BaseModel, Field


class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    lead_user_id: int | None = None
    sort_order: int = 0


class DepartmentUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    lead_user_id: int | None = None
    sort_order: int | None = None


class DepartmentBulkCreate(BaseModel):
    """온보딩 마법사 일괄 등록용."""
    departments: list[DepartmentCreate]
