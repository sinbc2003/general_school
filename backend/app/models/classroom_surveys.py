"""클래스룸 설문지 — Google Forms 식 응답 수집.

설계:
  - Survey: 한 설문. course_id로 강좌 소속 또는 단독.
  - SurveyQuestion: 질문 목록 (order로 정렬).
    type: short_text | long_text | single_choice | multi_choice | rating | date
  - SurveyResponse: 한 응답자의 1회 제출.
    is_anonymous=True면 respondent_id=null.
    is_anonymous=False면 user_id 기록 + 중복 응답 차단 (allow_multiple=False).
  - SurveyAnswer: 응답 1건 안의 각 질문 답변.

access_mode:
  - course_members : 강좌 학생만 응답 가능
  - link_public    : 단축 링크 알면 인증된 사용자 누구나 (학교 LAN 가정)
  - specific_users : 미구현 (필요 시 SurveyMember 추가)

호환:
  - app/services/backup.py가 Base.metadata.sorted_tables로 자동 export.
  - app/models/__init__.py에 import 등록 必.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Survey(Base):
    """설문지."""
    __tablename__ = "classroom_surveys"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[int | None] = mapped_column(
        ForeignKey("classroom_courses.id", ondelete="CASCADE"), nullable=True,
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 상태: draft (편집 중) | active (응답 받는 중) | closed (마감)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    allow_multiple_responses: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # 접근 모드 — course_members | link_public (specific_users는 향후)
    access_mode: Mapped[str] = mapped_column(
        String(30), default="course_members", nullable=False,
    )
    open_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 응답 수정 허용 시간(분). 0이면 제출 후 수정 불가. >0이면 그 분만큼 본인 응답 수정 가능.
    # 작성자가 동적으로 변경 가능 — 이미 제출된 응답은 동일 정책 즉시 적용 (submitted_at 기준 재계산).
    response_edit_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
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

    questions: Mapped[list["SurveyQuestion"]] = relationship(
        back_populates="survey", cascade="all, delete-orphan",
        order_by="SurveyQuestion.order",
    )
    responses: Mapped[list["SurveyResponse"]] = relationship(
        back_populates="survey", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_surveys_course_id", "course_id"),
        Index("ix_classroom_surveys_author_id", "author_id"),
        Index("ix_classroom_surveys_status", "status"),
    )


class SurveyQuestion(Base):
    """설문 질문."""
    __tablename__ = "classroom_survey_questions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    survey_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_surveys.id", ondelete="CASCADE"), nullable=False,
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    # short_text | long_text | single_choice | multi_choice | rating | date
    question_type: Mapped[str] = mapped_column(String(30), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # single/multi_choice: ["옵션1", "옵션2", ...]. 그 외 null.
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # rating type 최댓값 (1~rating_max). 기본 5.
    rating_max: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    survey: Mapped["Survey"] = relationship(back_populates="questions")
    answers: Mapped[list["SurveyAnswer"]] = relationship(
        back_populates="question", cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_classroom_survey_questions_survey_id", "survey_id"),
        Index("ix_classroom_survey_questions_order", "survey_id", "order"),
    )


class SurveyResponse(Base):
    """한 응답자의 1회 응답 (n개 SurveyAnswer 포함)."""
    __tablename__ = "classroom_survey_responses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    survey_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_surveys.id", ondelete="CASCADE"), nullable=False,
    )
    # is_anonymous=False면 user_id 기록. True면 null (중복 방지는 response_hash로).
    respondent_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    # 익명 응답 중복 방지용 — IP+UA 해시. 미구현이면 null.
    response_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    survey: Mapped["Survey"] = relationship(back_populates="responses")
    answers: Mapped[list["SurveyAnswer"]] = relationship(
        back_populates="response", cascade="all, delete-orphan",
    )

    __table_args__ = (
        # 실명 응답 + allow_multiple_responses=False면 (survey_id, respondent_id) 중복 차단
        # 라우터에서 사전 체크 (UniqueConstraint는 null 허용으로 익명에는 영향 X)
        Index("ix_classroom_survey_responses_survey_id", "survey_id"),
        Index("ix_classroom_survey_responses_respondent_id", "respondent_id"),
    )


class SurveyAnswer(Base):
    """응답 1건 안의 각 질문 답변."""
    __tablename__ = "classroom_survey_answers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    response_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_survey_responses.id", ondelete="CASCADE"), nullable=False,
    )
    question_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_survey_questions.id", ondelete="CASCADE"), nullable=False,
    )
    # short_text / long_text / date: text_value (date는 ISO 문자열).
    text_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    # single_choice: ["옵션1"] (한 개)
    # multi_choice: ["옵션1", "옵션3"] (여러 개)
    choice_values: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # rating: 정수 1~rating_max
    rating_value: Mapped[int | None] = mapped_column(Integer, nullable=True)

    response: Mapped["SurveyResponse"] = relationship(back_populates="answers")
    question: Mapped["SurveyQuestion"] = relationship(back_populates="answers")

    __table_args__ = (
        UniqueConstraint("response_id", "question_id", name="uq_survey_answer"),
        Index("ix_classroom_survey_answers_response_id", "response_id"),
        Index("ix_classroom_survey_answers_question_id", "question_id"),
    )
