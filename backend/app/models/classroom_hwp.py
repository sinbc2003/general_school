"""클래스룸 HWP 문서 — 한컴 .hwp/.hwpx 파일 + 공유 권한.

설계:
  - ClassroomHwp: 한 hwp/hwpx 파일. course_id로 강좌 소속 또는 단독.
  - HwpMember: access_mode="specific_users" 시 멤버 + role(editor/viewer).
  - 협업 편집 미지원 (rhwp v2.0 로드맵). 한 명이 편집·저장 → 다른 사람은
    refresh 시 최신 내용 받음. 동시 편집 시 마지막 저장 우선.
  - 파일은 backend/storage/hwps/{id}/<uuid>.{hwp|hwpx} 에 저장.
    files/router.py가 권한 가드 후 서빙.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassroomHwp(Base):
    """HWP 문서."""
    __tablename__ = "classroom_hwps"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=True,
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="제목 없는 HWP")
    # access_mode: course_members | specific_users | link_public
    access_mode: Mapped[str] = mapped_column(
        String(30), default="specific_users", nullable=False,
    )
    # storage 안 상대 경로 (예: "hwps/42/abc123.hwpx"). 빈 hwp 생성 시 null,
    # 첫 저장 후 채워짐.
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # "hwp" | "hwpx" — file_path가 있으면 이게 채워짐
    file_format: Mapped[str | None] = mapped_column(String(8), nullable=True)
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("drive_folders.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    members: Mapped[list["HwpMember"]] = relationship(
        back_populates="hwp", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_hwps_course_id", "course_id"),
        Index("ix_classroom_hwps_owner_id", "owner_id"),
    )


class HwpMember(Base):
    """specific_users 모드의 멤버 + role."""
    __tablename__ = "classroom_hwp_members"
    __table_args__ = (
        UniqueConstraint("hwp_id", "user_id"),
        Index("ix_classroom_hwp_members_hwp_id", "hwp_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    hwp_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_hwps.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # editor | viewer
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="editor")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    hwp: Mapped["ClassroomHwp"] = relationship(back_populates="members")
