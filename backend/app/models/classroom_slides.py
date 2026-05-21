"""클래스룸 프리젠테이션 — Google Slides 식 실시간 동시 편집.

설계:
  - Presentation: deck (슬라이드 묶음). access_mode 정책은 협업 문서와 동일.
  - Slide: deck 안의 한 장. Y.Doc fragment 단위.
    각 slide는 별도 TipTap fragment("slide-{slide_id}") — 같은 Y.Doc 공유.
  - Y.Doc은 deck 단위 1개 (documentName="deck-{id}"). slide 순서·메타도 Y.Doc 안에서
    동기화하면 reorder도 협업 가능. 다만 backend 모델은 슬라이드 순서를 권위로 유지
    (DB가 진실의 원천 — Y.Doc은 fragment 내용 협업용).
  - 발표 모드: slide.order 순으로 렌더 + 키보드/터치 페이지 전환.
  - 백업: yjs_state 컬럼 LargeBinary — Base.metadata로 자동 export.

권한:
  - ClassroomDocument와 동일 패턴 (access_mode, DocumentMember 별도 X — 본 모듈은
    PresentationMember 별도 모델).

호환:
  - app/models/__init__.py에 import 등록 필수.
  - frontend의 ShareDocModal을 일반화해 deck도 같은 share 모달 사용 (P5에서).
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassroomPresentation(Base):
    """프리젠테이션 deck — 슬라이드 묶음."""
    __tablename__ = "classroom_presentations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=True,
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="제목 없음 프리젠테이션")
    # Y.Doc state — deck 단위 협업 (slide fragment 여러 개 공유)
    yjs_state: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # 접근 모드: course_members | specific_users | link_public (ClassroomDocument와 동일)
    access_mode: Mapped[str] = mapped_column(
        String(30), default="course_members", nullable=False,
    )
    # 발표 모드 설정 (JSON: theme/transition 등 향후 확장)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Soft delete (휴지통 30일 보관)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("drive_folders.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    slides: Mapped[list["ClassroomSlide"]] = relationship(
        back_populates="presentation", cascade="all, delete-orphan",
        order_by="ClassroomSlide.order",
    )
    members: Mapped[list["PresentationMember"]] = relationship(
        back_populates="presentation", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_presentations_course_id", "course_id"),
        Index("ix_classroom_presentations_owner_id", "owner_id"),
    )


class ClassroomSlide(Base):
    """deck 안의 한 슬라이드.

    실제 본문(텍스트·이미지 등)은 Y.Doc의 fragment("slide-{id}")에 저장.
    DB의 plain_text는 검색용 fallback (Hocuspocus가 주기적 갱신).
    """
    __tablename__ = "classroom_slides"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    presentation_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_presentations.id", ondelete="CASCADE"), nullable=False,
    )
    # deck 안 순서 — 0부터 시작. reorder 시 갱신.
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 슬라이드 제목 — 썸네일·panel 라벨용. 본문 첫 줄 자동 추출도 가능.
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 검색용 plaintext (Hocuspocus 주기 갱신)
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 슬라이드 layout/background (JSON)
    settings: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    presentation: Mapped["ClassroomPresentation"] = relationship(back_populates="slides")

    __table_args__ = (
        Index("ix_classroom_slides_presentation_id", "presentation_id"),
        Index("ix_classroom_slides_order", "presentation_id", "order"),
    )


class PresentationMember(Base):
    """access_mode='specific_users'일 때 명시 권한.

    ClassroomDocument의 DocumentMember와 동일 패턴.
    """
    __tablename__ = "classroom_presentation_members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    presentation_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_presentations.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # role: editor | viewer
    role: Mapped[str] = mapped_column(String(20), default="editor", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    presentation: Mapped["ClassroomPresentation"] = relationship(back_populates="members")

    __table_args__ = (
        UniqueConstraint("presentation_id", "user_id", name="uq_presentation_member"),
        Index("ix_classroom_presentation_members_presentation_id", "presentation_id"),
        Index("ix_classroom_presentation_members_user_id", "user_id"),
    )
