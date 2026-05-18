"""Pydantic schemas for system module endpoints."""

from typing import Literal

from pydantic import BaseModel, Field


class MenuSettingsUpdate(BaseModel):
    """PUT /api/system/menu-settings"""
    hidden_menus: list[str] = Field(default_factory=list)


class BrandingUpdate(BaseModel):
    """PUT /api/system/branding — 부분 업데이트."""
    title: str | None = Field(None, max_length=200)
    school_name: str | None = Field(None, max_length=200)


class TeacherViewScopeUpdate(BaseModel):
    """PUT /api/system/policy/teacher-view-scope"""
    scope: Literal["all", "scoped"]


class AuditRetentionUpdate(BaseModel):
    """PUT /api/system/audit/retention — 부분 업데이트."""
    retention_days: int | None = Field(None, ge=30, le=365 * 10)
    retention_keep_sensitive_days: int | None = Field(None, ge=30, le=365 * 20)


class BackupScheduleUpdate(BaseModel):
    """PUT /api/system/backup/schedule — 부분 업데이트."""
    enabled: bool | None = None
    interval_hours: int | None = Field(None, ge=1, le=720)
    retention_count: int | None = Field(None, ge=1, le=365)
    output_dir: str | None = Field(None, min_length=1)
