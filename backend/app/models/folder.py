"""드라이브 폴더 — 사용자별 트리 구조.

설계:
  - 사용자당 root 폴더(parent_id=NULL) 여러 개.
  - 다단계 중첩 허용 (parent_id self-FK).
  - 자동 생성 폴더(is_system_locked=True)는 수정/삭제 불가.
    학기 전환 시 folder_seed가 누적 추가 (1학기 폴더는 보존).
  - 수동 폴더(is_system_locked=False)는 자유.
  - 자료(docs/sheets/decks/surveys/hwps)는 각자 folder_id FK로 폴더에 연결.

auto_kind:
  - department         : 부서 (학기별) — "01. 2026학년도 1학기 교무부"
  - grade_office       : 학년부 (학기별) — "02. 2026학년도 1학기 1학년부"
  - homeroom           : 담임 학급 (학년 단위, 학기 prefix 없음) — "03. 2026학년도 1학년 3반 담임"
  - class_belonging    : 학생 본인 학급 (학년 단위) — "01. 2026학년도 1학년 1반"
  - subject_teaching   : 교사 강좌 (학기별) — "04. 2026학년도 1학기 수학I"
  - subject_enrolled_wrapper : 학생 수강과목 wrapper (학기별) — "02. 2026학년도 1학기 수강과목"
  - subject_enrolled   : 학생 수강 강좌 (wrapper 안) — "01. 수학I"
  - admin_office       : 관리자 폴더 (학기별) — "01. 2026학년도 1학기 관리자"
  - NULL               : 수동 생성

source_kind / source_id:
  - department / dept_id    (auto_kind=department)
  - grade_office / grade    (auto_kind=grade_office, source_id=학년 1/2/3)
  - homeroom / "G-C"        (auto_kind=homeroom, source_id encoded "1-3" 식 — string 저장 불가하므로 grade*100+class)
  - class_belonging / "G-C" (auto_kind=class_belonging)
  - course / course_id      (auto_kind in [subject_teaching, subject_enrolled])
  - enrolled_wrapper / semester_id (auto_kind=subject_enrolled_wrapper)
  - admin_office / semester_id (auto_kind=admin_office)

멱등 보장:
  (owner_id, auto_kind, semester_id, source_kind, source_id) 조합으로 select → 없으면 insert.

호환:
  - app/services/backup.py는 Base.metadata로 자동 export. 새 테이블 자동 포함.
  - app/models/__init__.py에 import 등록 필수.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Folder(Base):
    """드라이브 폴더 — 사용자별 트리 구조."""

    __tablename__ = "drive_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # 다단계 중첩 — 루트 폴더는 NULL
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("drive_folders.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # 자동 생성 메타
    auto_kind: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    semester_id: Mapped[int | None] = mapped_column(
        ForeignKey("semesters.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    source_kind: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 정렬 순서. 루트는 사용자당 누적, 자식은 부모 내부에서.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 잠금 폴더(자동 생성)는 이름변경/삭제 차단
    is_system_locked: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false",
    )

    # Soft delete (수동 폴더만 — 잠금 폴더는 거부)
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True,
    )
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_drive_folders_owner_parent", "owner_id", "parent_id"),
        Index(
            "ix_drive_folders_owner_auto",
            "owner_id", "auto_kind", "semester_id", "source_kind", "source_id",
        ),
        UniqueConstraint(
            "owner_id", "auto_kind", "semester_id", "source_kind", "source_id",
            name="uq_drive_folder_auto_idem",
        ),
    )
