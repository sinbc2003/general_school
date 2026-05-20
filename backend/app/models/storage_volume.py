"""스토리지 볼륨 — 외장 SSD/HDD 추가 시 등록하는 볼륨 목록.

설계:
  - 본체 SSD가 부족하면 외장 SSD 마운트 → super_admin이 볼륨 추가
  - 새 업로드는 active + 여유 있는 볼륨에 자동 분산
  - 파일 메타 (FileObject 등)에 volume_id 컬럼 추가하면 정확한 경로 매핑
  - Phase 1.0 단계에서는 단일 볼륨 (기본 storage 디렉터리) — 본 모델은 Phase 2 인프라

운영 흐름:
  1. 학교가 외장 SSD를 노트북에 꽂음
  2. WSL/Linux가 마운트 (예: /mnt/external1)
  3. super_admin이 /system/storage에서 볼륨 추가 (name + path + capacity_bytes)
  4. 헬스체크가 주기적으로 mount 가능 여부 + 여유 용량 확인
  5. 새 업로드 시 active 볼륨 중 우선순위 + 여유 용량 기준 선택
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StorageVolume(Base):
    __tablename__ = "storage_volumes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 표시명 (예: "외장 SSD 1TB - WD")
    name: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 마운트 경로 (예: "/mnt/external1" 또는 "backend/storage")
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    # 사용자 등록 시 알려준 총 용량
    capacity_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # 실제 사용량 (헬스체크가 주기 갱신, 또는 파일 add/remove 시 증감)
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    # 새 업로드 받기 가능 여부 (false면 read-only)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 분산 우선순위 (낮을수록 먼저 채움)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    # 마지막 헬스체크 결과 (mounted/missing/error)
    last_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
