"""클래스룸 모델 — 강좌(Course), 수강 학생(CourseStudent), 클래스룸 글(CoursePost).

설계:
  - 학기 단위 격리 (semester_id FK) — 학기 끝나면 archived
  - 학급 단위 수업 (class_name="2-3") 또는 선택과목 (class_name=None) 둘 다 지원
  - 학생 명단은 별도 N:M 테이블 (학급 단위면 자동 채움, 선택과목은 교사가 등록)
  - 글은 강좌 단위 (CoursePost) — 공지·자료·과제 링크. 댓글은 향후 추가.

추후 확장 후보:
  - CourseComment (글 댓글)
  - CourseAttendance (출석)
  - Assignment / Contest와 강좌 연계 (course_id FK)
"""

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Course(Base):
    """강좌 — 학기 단위 격리. 1교사 + 1과목 + (학급 or 선택)."""
    __tablename__ = "classroom_courses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    subject: Mapped[str] = mapped_column(String(100), nullable=False)
    # 학급 단위 수업 = "2-3" (해당 학급 학생 자동 등록 대상)
    # 선택과목 = None (교사가 수강 학생 직접 등록)
    class_name: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 표시명 — 자동 생성("2-3 수학") 또는 교사 지정("미적분 A반")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    students: Mapped[list["CourseStudent"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )
    posts: Mapped[list["CoursePost"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "semester_id", "teacher_id", "subject", "class_name",
            name="uq_course_semester_teacher_subject_class",
        ),
        Index("ix_classroom_courses_semester_id", "semester_id"),
        Index("ix_classroom_courses_teacher_id", "teacher_id"),
    )


class CourseStudent(Base):
    """수강 학생 (N:M)."""
    __tablename__ = "classroom_course_students"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # active / dropped (수강 취소)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    course: Mapped["Course"] = relationship(back_populates="students")

    __table_args__ = (
        UniqueConstraint("course_id", "student_id", name="uq_course_student"),
        Index("ix_course_students_course_id", "course_id"),
        Index("ix_course_students_student_id", "student_id"),
    )


class CoursePost(Base):
    """클래스룸 글 — 공지·자료·과제 링크.

    post_type:
      - notice: 공지
      - material: 자료 (파일 첨부 가능)
      - assignment_ref: 외부 과제 모듈 참조 (assignment_id 별도)
    """
    __tablename__ = "classroom_posts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    post_type: Mapped[str] = mapped_column(
        String(30), default="notice", nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 첨부 파일 (선택). /storage/classroom/{uuid}.ext 형식.
    # files/router.py 의 _GUARDS에 classroom section 등록 필요.
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    course: Mapped["Course"] = relationship(back_populates="posts")

    __table_args__ = (
        Index("ix_classroom_posts_course_id", "course_id"),
        Index("ix_classroom_posts_post_type", "post_type"),
    )
