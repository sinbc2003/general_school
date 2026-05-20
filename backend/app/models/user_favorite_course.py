"""사용자 즐겨찾기 강좌 (M2M) — 클래스룸 메인 페이지 상단에 별도 섹션 표시."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserFavoriteCourse(Base):
    __tablename__ = "user_favorite_courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_user_favorite_course"),
        Index("ix_user_favorite_courses_user_id", "user_id"),
    )
