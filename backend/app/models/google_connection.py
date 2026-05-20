"""Google OAuth 연결 — 사용자 1명당 1개 (Google Drive 등 API 접근용).

토큰 보안:
  - refresh_token: Fernet 암호화 저장 (ENCRYPTION_MASTER_KEY로)
  - access_token: 메모리 캐시 only (DB 저장 X — refresh로 즉시 재발급 가능)
  - expires_at: access_token 만료 시각 (캐시 무효화 기준)

토큰 라이프사이클:
  1. 사용자가 OAuth 동의 → callback에서 refresh_token 수신 → DB 저장
  2. API 호출 시 refresh_token으로 access_token 재발급 (~1h 유효)
  3. 사용자가 연결 해제 → row 삭제 + Google에 token revoke 요청
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class GoogleConnection(Base):
    __tablename__ = "google_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True,
    )
    # 사용자 확인용. OAuth scope의 userinfo.email에서 받음.
    google_email: Mapped[str] = mapped_column(String(255), nullable=False)
    # Fernet 암호화된 refresh_token (encrypt_value로 처리).
    refresh_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # 부여된 scope (필요 시 추가 동의 안내).
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )
