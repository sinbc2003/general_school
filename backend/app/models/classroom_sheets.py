"""클래스룸 스프레드시트 — Univer SDK 기반.

설계:
- ClassroomSheet: 시트 워크북 (Google Sheets의 spreadsheet 단위)
- Univer Workbook JSON을 yjs_state(LargeBinary)로 저장 — Yjs CRDT 통해 동시 편집
- access_mode: course_members | specific_users | link_public
- 설문 응답 연동: source_survey_id (있으면 결과 자동 채움)

권한 패턴: ClassroomDocument와 동일 (이미 검증됨).

호환:
- app/models/__init__.py에 import 등록 (백업 자동 포함 보장)
- Hocuspocus auth.ts: extractTarget(documentName)에 "sheet-{id}" 패턴 추가
- 신규 endpoint /api/classroom/sheets/{id}/yjs-snapshot
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassroomSheet(Base):
    """스프레드시트 워크북 — 시트 1개 묶음 (Google Sheets와 동일)."""
    __tablename__ = "classroom_sheets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=True,
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="제목 없는 스프레드시트")

    # Y.Doc state — Univer Workbook의 CRDT 상태. binary로 직렬화.
    yjs_state: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    # access_mode (ClassroomDocument 패턴): course_members | specific_users | link_public
    access_mode: Mapped[str] = mapped_column(
        String(30), default="specific_users", nullable=False,
    )

    # 설문 응답에서 자동 생성된 시트면 source_survey_id 채움.
    # NULL = 빈 시트로 직접 만든 것.
    source_survey_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_surveys.id", ondelete="SET NULL"), nullable=True,
    )

    # 옵션 (행/열 freeze 등)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    members: Mapped[list["SheetMember"]] = relationship(
        back_populates="sheet", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_sheets_course_id", "course_id"),
        Index("ix_classroom_sheets_owner_id", "owner_id"),
        Index("ix_classroom_sheets_survey_id", "source_survey_id"),
    )


class SheetMember(Base):
    """access_mode='specific_users'일 때 명시 권한.

    role: editor (편집) | viewer (읽기)
    """
    __tablename__ = "classroom_sheet_members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sheet_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_sheets.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    role: Mapped[str] = mapped_column(String(20), default="editor", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    sheet: Mapped["ClassroomSheet"] = relationship(back_populates="members")

    __table_args__ = (
        UniqueConstraint("sheet_id", "user_id", name="uq_sheet_member"),
        Index("ix_classroom_sheet_members_sheet_id", "sheet_id"),
        Index("ix_classroom_sheet_members_user_id", "user_id"),
    )
