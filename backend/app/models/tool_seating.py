"""자리배치 (seating arrangement) — 수업 도구 #7.

교사가 교실 자리표를 만들고(담임/교과 명단 가져오기), 제약(특정 학생 인접 금지·짝·혼자)
을 적용해 랜덤 배치한 뒤 A4 교탁 게시용으로 인쇄한다.

테이블:
  - tool_seating_charts : 자리표 1건 (교사 자산 — 드라이브 통합, 학기 무관 재사용)

JSON 컬럼 (전부 nullable — 프런트가 점진적으로 채움):
  layout      : 교실 배치 — 책상 그리드 + 교탁/칠판/문 위치
                {"rows": int, "cols": int,
                 "desks": [{"id": "r0c0", "row": 0, "col": 0, "seats": 1|2}],
                 "aisles": [col, ...]            # col 다음(오른쪽)에 통로 → 가로 인접 끊김
                 "podium": {"side": "front", "align": "left|center|right"} | null,
                 "board": "front",               # 칠판 위치 (앞 고정)
                 "doors": [{"id","wall":"front|back|left|right","pos":0..1}],
                 "facing": "front"}
  roster      : 명단 — [{"key": str(고정 키), "name": str, "number": int|None,
                         "student_number": int|None, "user_id": int|None}]
  constraints : 배치 제약 (학생에겐 안 보임 — 교사 전용)
                {"forbidden_pairs": [[keyA, keyB]],   # 인접 금지
                 "keep_together":   [[keyA, keyB]],   # 같은 2인 책상에 나란히
                 "alone":           [key],            # 책상 독점 (옆자리 빈칸)
                 "fixed":           {key: seatId},    # 고정 자리
                 "excluded":        [key]}            # 배치 제외
  assignment  : 현재 배치 — {seatId: rosterKey}  (좌석 id = "{deskId}.0" | "{deskId}.1")
"""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SeatingChart(Base):
    """자리표 1건 — 교사 소유. 명단·교실배치·제약·배치 결과를 JSON으로 보관."""

    __tablename__ = "tool_seating_charts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    layout: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    roster: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    constraints: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    assignment: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )

    # ── 내 드라이브 통합 (폴더·휴지통 30일 — drive ITEM_TYPES 규약) ──
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("drive_folders.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    deleted_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    # 자리표는 DB row(JSON)뿐이라 0 고정 — drive serialize 규약상 필요
    storage_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        Index("ix_tool_seating_charts_owner", "owner_id", "deleted_at"),
    )
