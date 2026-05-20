"""클래스룸 공동교사 (M2M) — Google Classroom 식.

Course.teacher_id는 owner (소유자, 강좌 생성자). 이 테이블은 co_teacher만 등록.
권한:
  - owner: 모든 권한 (글 작성/채점/멤버 관리 + 강좌 삭제 + co_teacher 관리)
  - co_teacher: 글 작성/채점/멤버 관리. 강좌 삭제·소유권 이관 불가.

학년부/학급 강좌도 동일 모델 사용 (학년부장 = owner, 담임 = co_teacher).
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CourseTeacher(Base):
    __tablename__ = "classroom_course_teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # owner / co_teacher
    role: Mapped[str] = mapped_column(String(20), default="co_teacher", nullable=False)
    added_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("course_id", "user_id", name="uq_course_teacher"),
        Index("ix_course_teachers_course_id", "course_id"),
        Index("ix_course_teachers_user_id", "user_id"),
    )
