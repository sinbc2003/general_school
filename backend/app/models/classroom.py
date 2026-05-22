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
from typing import Any

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Course(Base):
    """강좌 — 학기 단위 격리. teacher_id = owner(소유자). co_teacher는 CourseTeacher M2M.

    course_type:
      - subject: 교과 강좌 (기존 동작) — teacher_id=과목 담당 교사
      - grade_office: 학년부 강좌 — teacher_id=학년부장 (is_grade_lead=True), co_teachers=담임
      - class_homeroom: 학급 강좌 — teacher_id=담임, co_teachers=부담임

    viewable_by:
      - all_teachers: 모든 재직 교사가 본문/첨부 열람 (default, super_admin이 유동 조정)
      - assigned_only: 강좌의 owner/co_teacher + 수강생만
    """
    __tablename__ = "classroom_courses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    semester_id: Mapped[int] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), nullable=False
    )
    # owner (소유자). CourseTeacher M2M에서 role='owner'로 자동 동기화.
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

    # 강좌 타입
    course_type: Mapped[str] = mapped_column(
        String(30), default="subject", nullable=False, index=True,
    )
    # 학년부/학급 강좌에서 사용 (1/2/3). subject 강좌는 None.
    grade_level: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # 카드 디자인 커스터마이징
    banner_color: Mapped[str] = mapped_column(String(20), default="#7986CB", nullable=False)
    banner_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # 열람 권한 (super_admin이 강좌별 유동 조정)
    viewable_by: Mapped[str] = mapped_column(
        String(30), default="all_teachers", nullable=False,
    )

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

    # ── 과제 메타 (post_type='assignment_ref'일 때 주로 사용) ──
    # 모두 nullable — 공지/자료는 비워둠. 향후 점수·기한 시스템 확장에 활용.
    due_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    max_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 주제별 그룹화 (Google Classroom "주제 없음" 패턴). null이면 "주제 없음" 그룹.
    topic: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 첨부 자료 list. 각 원소:
    #   {type: "link", url: "...", title: "..."}
    #   {type: "file", file_url: "/storage/classroom/...", file_name: "..."}
    #   {type: "doc", doc_id: 42, title: "..."}        ← 협업 문서 연결
    #   {type: "survey", survey_id: 7, title: "..."}   ← 설문 연결
    # 형식 검증은 schemas Pydantic에서 진행.
    attachments: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)

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


class CoursePostComment(Base):
    """클래스룸 글 댓글 — Google Classroom "수업 댓글" 식.

    글 작성자·다른 댓글 작성자에게 알림이 발송됨 (notification 모듈에서 처리).
    삭제: 본인 또는 강좌 교사/admin.
    """
    __tablename__ = "classroom_post_comments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_posts.id", ondelete="CASCADE"), nullable=False,
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )

    __table_args__ = (
        Index("ix_classroom_post_comments_post_id", "post_id"),
        Index("ix_classroom_post_comments_author_id", "author_id"),
        Index("ix_classroom_post_comments_post_created", "post_id", "created_at"),
    )


class CourseChatbot(Base):
    """강좌별 챗봇 — 강좌마다 시스템 프롬프트 + (옵션) 모델 지정.

    학생이 글 첨부 또는 강좌 페이지에서 챗봇 클릭 시 그 system_prompt가
    적용된 ChatSession이 생성됨. 학생용 가드레일은 system_prompt 앞에 자동
    prepend (chatbot 모듈 sessions.py).

    provider/model_id가 null이면 chatbot_config의 default 사용.
    교사가 학생용 챗봇을 깔끔히 셋업할 수 있도록 강좌 단위로 격리.
    """
    __tablename__ = "course_chatbots"
    __table_args__ = (
        Index("ix_course_chatbots_course_id", "course_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=False,
    )
    # 학생/교사가 보는 챗봇 이름 (예: "수학 보조 챗봇")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 시스템 프롬프트 — 챗봇 페르소나·지시사항. 학생 가드레일은 별도로 prepend.
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # provider/model_id null이면 chatbot_config 기본값 사용 (학생/교사 분기 그대로 적용)
    provider: Mapped[str | None] = mapped_column(String(30), nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # 미래 확장 — 강좌 자료(doc/sheet/deck)를 챗봇 컨텍스트로 자동 주입할 때 사용
    context_attachments: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class PostAttachmentCopy(Base):
    """글 첨부 자료의 학생별 사본 매핑.

    share_mode="copy"인 첨부를 학생이 첫 접속(lazy) 시 학생 본인 사본을
    자동 생성하고, 이 매핑 row를 만든다. 교사 채점 페이지에서 학생별
    사본을 조회하는 데도 사용.

    UNIQUE(post_id, attachment_idx, student_id) — 학생당 사본 1개.
    copy_type/copy_id는 generic FK 없음 (type마다 별도 모델 — ClassroomDocument
    / ClassroomSheet / ClassroomPresentation / ClassroomHwp).
    """
    __tablename__ = "post_attachment_copies"
    __table_args__ = (
        UniqueConstraint("post_id", "attachment_idx", "student_id",
                         name="uq_post_attachment_copy_per_student"),
        Index("ix_post_attachment_copies_post", "post_id", "attachment_idx"),
        Index("ix_post_attachment_copies_student", "student_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_posts.id", ondelete="CASCADE"), nullable=False,
    )
    # post.attachments JSON list 안에서의 0-based 인덱스. 글 편집 시 attachment
    # 순서 변경되면 매핑 깨질 수 있으므로 backend의 사본 lookup 헬퍼는 attachment
    # type+id 조합도 함께 검증 (idx만 믿지 X).
    attachment_idx: Mapped[int] = mapped_column(Integer, nullable=False)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    # "doc" | "sheet" | "deck" | "hwp"
    copy_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # 사본 자료의 id (해당 type 모델). 자료 삭제 시 row는 남아있을 수 있어
    # endpoint에서 db.get으로 None 처리 (휴지통/삭제 자료 무시).
    copy_id: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
