"""Pydantic schemas for permissions module endpoints.

dict body를 typed schema로 마이그레이션 — 타입 안전성 + OpenAPI 문서 + 자동 검증.

설계 원칙:
- 모든 schema는 부분 업데이트 가능하면 Optional로
- 검증 로직(범위/포맷)은 Pydantic field validator에 두기 (라우터에서 if-check 제거)
"""

from typing import Literal

from pydantic import BaseModel, Field


# ── 역할 권한 매트릭스 ──

class RolePermissionsUpdate(BaseModel):
    """PUT /api/permissions/roles/{role}"""
    permissions: list[str] = Field(default_factory=list)


# ── 사용자 권한 ──

class UserPermissionsUpdate(BaseModel):
    """PUT /api/permissions/users/{user_id}"""
    permissions: list[str] = Field(default_factory=list)


# ── 권한 그룹 ──

class GroupCreate(BaseModel):
    """POST /api/permissions/groups"""
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)


class GroupUpdate(BaseModel):
    """PUT /api/permissions/groups/{group_id} — 부분 업데이트."""
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    permissions: list[str] | None = None


class GroupAssignMember(BaseModel):
    """POST /api/permissions/groups/{group_id}/assign"""
    user_id: int


# ── 직책 권한 템플릿 ──

class PositionTemplateCreate(BaseModel):
    """POST /api/permissions/position-templates"""
    key: str = Field(..., min_length=1, max_length=100,
                     pattern=r"^[A-Za-z0-9._-]+$",
                     description="영문/숫자/_/-/. 만 허용")
    display_name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    category: str = Field("기타", max_length=50)
    permission_keys: list[str] = Field(default_factory=list)


class PositionTemplateUpdate(BaseModel):
    """PUT /api/permissions/position-templates/{tid} — 부분 업데이트.

    key는 변경 불가 (enrollment 매핑 안정성).
    """
    display_name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    category: str | None = Field(None, max_length=50)
    permission_keys: list[str] | None = None


class PositionApplyToDepartment(BaseModel):
    """POST /api/permissions/position-templates/{tid}/apply-to-department"""
    semester_id: int = Field(..., gt=0)
    department: str = Field(..., min_length=1)
    include_roles: list[Literal["teacher", "staff"]] | None = None
    replace: bool = False


# ── 정책 (super_admin 전용) ──

class DesignatedAdminModeUpdate(BaseModel):
    """PUT /api/permissions/policy/designated-admin-mode"""
    mode: Literal["full", "scoped"]


class AdminTwoFaRequiredUpdate(BaseModel):
    """PUT /api/permissions/policy/admin-2fa-required"""
    required: bool


class PasswordPolicyUpdate(BaseModel):
    """PUT /api/permissions/policy/password — 부분 업데이트."""
    min_length: int | None = Field(None, ge=6, le=64)
    require_letter: bool | None = None
    require_digit: bool | None = None
    require_symbol: bool | None = None
