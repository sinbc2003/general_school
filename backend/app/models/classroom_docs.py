"""클래스룸 협업 문서 — Google Docs 식 동시 편집 (Yjs CRDT).

설계:
  - Document: 한 문서. course_id가 있으면 강좌 소속, 없으면 단독 문서.
  - DocumentMember: access_mode='specific_users'일 때 명시 권한 부여.
    course_members 모드면 자동으로 강좌 학생 + 교사.
  - DocumentRevision: 주기적 snapshot (롤백·복원·감사 로그).
    Hocuspocus 서버가 onChange hook으로 호출.

yjs_state:
  - Y.Doc.encodeStateAsUpdate(doc) 결과 (Uint8Array)
  - PostgreSQL: BYTEA, SQLite: BLOB
  - Hocuspocus가 in-memory에서 모든 update merge → 1분마다 DB로 snapshot

plain_text:
  - 검색용 fallback. Yjs CRDT 상태에서 추출한 텍스트.
  - 주기적으로 Hocuspocus가 갱신. 색인은 별도 (현재는 LIKE만).

access_mode:
  - "course_members" : course_id로 결정 (강좌 학생+교사 자동)
  - "specific_users" : DocumentMember 테이블 명시
  - "link_public"    : 단축 링크 알면 익명 view 가능 (편집은 아님)

호환:
  - app/services/backup.py는 Base.metadata.sorted_tables로 자동 export → LargeBinary 자동 포함
  - app/models/__init__.py에 import 등록 必
"""

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ClassroomDocument(Base):
    """협업 문서 (Yjs 기반 실시간 편집)."""
    __tablename__ = "classroom_docs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # 강좌 소속 (null이면 단독 문서)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=True,
    )
    # 작성자 (항상 편집 가능)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="제목 없음")
    # Yjs CRDT 상태 (Y.Doc.encodeStateAsUpdate). 처음엔 빈 문서로 시작 → null OK.
    yjs_state: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # 검색용 plaintext (Hocuspocus가 주기 갱신). 색인은 향후 fts.
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 접근 모드: course_members | specific_users | link_public
    access_mode: Mapped[str] = mapped_column(
        String(30), default="course_members", nullable=False,
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    members: Mapped[list["DocumentMember"]] = relationship(
        back_populates="document", cascade="all, delete-orphan",
    )
    revisions: Mapped[list["DocumentRevision"]] = relationship(
        back_populates="document", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_docs_course_id", "course_id"),
        Index("ix_classroom_docs_owner_id", "owner_id"),
    )


class DocumentMember(Base):
    """access_mode='specific_users'일 때 사용. course_members면 자동(테이블 안 씀)."""
    __tablename__ = "classroom_doc_members"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_docs.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # role: editor | viewer
    role: Mapped[str] = mapped_column(String(20), default="editor", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    document: Mapped["ClassroomDocument"] = relationship(back_populates="members")

    __table_args__ = (
        UniqueConstraint("document_id", "user_id", name="uq_doc_member"),
        Index("ix_classroom_doc_members_document_id", "document_id"),
        Index("ix_classroom_doc_members_user_id", "user_id"),
    )


class DocumentRevision(Base):
    """주기적 snapshot (롤백·복원·감사 로그).

    Hocuspocus가 1분 debounce로 onChange → FastAPI snapshot endpoint POST.
    그 endpoint가 Document.yjs_state 갱신 + 이 테이블에 새 revision 추가.

    너무 많이 쌓이지 않도록 향후 cleanup task 필요 (예: 100개 초과 시 오래된 거 삭제).
    """
    __tablename__ = "classroom_doc_revisions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_docs.id", ondelete="CASCADE"), nullable=False,
    )
    yjs_state: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 마지막 편집자 (Hocuspocus snapshot 시점 기준)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    document: Mapped["ClassroomDocument"] = relationship(back_populates="revisions")

    __table_args__ = (
        Index("ix_classroom_doc_revisions_document_id", "document_id"),
        Index("ix_classroom_doc_revisions_created_at", "created_at"),
    )
