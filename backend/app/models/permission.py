"""권한 모델 — 관계형 권한 시스템

보수적 기본값 원칙:
- 새 권한 키가 추가되면 super_admin + designated_admin만 자동 접근
- 교사/직원/학생에게는 관리자가 명시적으로 role_permissions에 추가해야 노출
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Permission(Base):
    """권한 레지스트리 — 시스템의 모든 권한 키를 등록"""
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    requires_2fa: Mapped[bool] = mapped_column(Boolean, default=False)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RolePermission(Base):
    """역할별 기본 권한 — 관리자 UI에서 토글"""
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role", "permission_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    permission_id: Mapped[int] = mapped_column(Integer, nullable=False)
    granted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserPermission(Base):
    """개인별 추가 권한 — 지정관리자에게 개별 권한 부여"""
    __tablename__ = "user_permissions"
    __table_args__ = (UniqueConstraint("user_id", "permission_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    permission_id: Mapped[int] = mapped_column(Integer, nullable=False)
    granted_by: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PermissionGroup(Base):
    """권한 그룹 — 이름 붙은 권한 묶음"""
    __tablename__ = "permission_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PermissionGroupItem(Base):
    """권한 그룹의 항목"""
    __tablename__ = "permission_group_items"
    __table_args__ = (UniqueConstraint("group_id", "permission_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[int] = mapped_column(Integer, nullable=False)
    permission_id: Mapped[int] = mapped_column(Integer, nullable=False)


class UserPermissionGroup(Base):
    """사용자에게 할당된 권한 그룹"""
    __tablename__ = "user_permission_groups"
    __table_args__ = (UniqueConstraint("user_id", "group_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    group_id: Mapped[int] = mapped_column(Integer, nullable=False)
    granted_by: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
