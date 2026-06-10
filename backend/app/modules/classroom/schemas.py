"""Pydantic schemas — classroom 모듈."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


PostType = Literal["notice", "material", "assignment_ref"]
AttachmentType = Literal[
    "link", "file", "doc", "survey", "sheet", "deck", "hwp", "chatbot", "problemset",
    "live_quiz", "word_deck", "board",
]

# 첨부 공유 모드 — Google Classroom 식
#   view : 학생이 읽기만 (default). 자료 본체 access_mode가 보호.
#   edit : 학생이 함께 편집 (협업). docs/sheets/decks/hwp 적용 가능.
#   copy : 학생별 본인 사본 자동 생성 → 본인만 편집 → 교사가 모든 사본 채점.
#          docs/sheets/decks/hwp 만 적용. link/file/survey/chatbot은 N/A → view 강제.
ShareMode = Literal["view", "edit", "copy"]


class Attachment(BaseModel):
    """글 첨부 항목. 다형 — type 별로 선택 필드.

    예: {type: "link", url: "https://...", title: "참고 자료"}
        {type: "doc", doc_id: 42, title: "프로젝트 노트", share_mode: "edit"}
        {type: "sheet", sheet_id: 7, title: "성적", share_mode: "view"}
        {type: "deck", deck_id: 12, title: "1차 보고", share_mode: "copy"}
        {type: "hwp", hwp_id: 5, title: "수업 자료"}
        {type: "chatbot", chatbot_id: 9, title: "1단원 도우미"}

    share_mode (Google Classroom 식):
      - view : 보기만 (default)
      - edit : 학생이 함께 편집 (협업)
      - copy : 학생별 본인 사본 자동 생성 (과제 채점 워크플로우)
        ↳ 실제 사본 생성 로직은 별도 endpoint (Phase 2). 본 필드는 의도 저장.

    chatbot 첨부: 학생/교사가 클릭하면 POST /api/classroom/chatbots/{bid}/start-session
    호출 → ChatSession 생성 후 /chat?sid=… 또는 /s/chat?sid=… 로 redirect.
    """
    type: AttachmentType
    title: str = Field(..., min_length=1, max_length=255)
    url: str | None = None
    file_url: str | None = None
    file_name: str | None = None
    doc_id: int | None = None
    survey_id: int | None = None
    sheet_id: int | None = None
    deck_id: int | None = None
    hwp_id: int | None = None
    chatbot_id: int | None = None
    problemset_id: int | None = None
    # 라이브 퀴즈 세션 첨부 — 클릭 시 학생은 /s/quiz/{pin} 입장, 교사는 진행 화면
    live_quiz_id: int | None = None
    # 단어장 첨부 — 학생 클릭 시 학습 화면 (강좌 첨부가 곧 학습 접근 권한)
    word_deck_id: int | None = None
    # 보드(Padlet형) 첨부 — 강좌 첨부가 곧 읽기+쓰기(카드 붙이기) 접근 권한
    board_id: int | None = None
    share_mode: ShareMode = "view"


class CourseCreate(BaseModel):
    """POST /api/classroom/courses — 강좌 수동 생성."""
    teacher_id: int
    subject: str = Field(..., min_length=1, max_length=100)
    class_name: str | None = Field(None, max_length=20, description="학급 단위 수업이면 '2-3', 선택과목은 null")
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    semester_id: int | None = None  # 미지정 시 현재 학기


class CourseUpdate(BaseModel):
    """PUT /api/classroom/courses/{cid} — 부분 업데이트."""
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    is_active: bool | None = None
    teacher_id: int | None = None


class CourseStudentAdd(BaseModel):
    """POST /api/classroom/courses/{cid}/students — 개별 학생 추가."""
    student_id: int


class CourseStudentBulk(BaseModel):
    """POST /api/classroom/courses/{cid}/students/bulk — 학번/이름 일괄 등록."""
    # student_number(int, 5자리 한국 학번) 또는 user_id 직접
    student_numbers: list[int] | None = None
    user_ids: list[int] | None = None


class CoursePostCreate(BaseModel):
    """POST /api/classroom/courses/{cid}/posts"""
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(..., min_length=1)
    post_type: PostType = "notice"
    is_pinned: bool = False
    # 과제 메타 (assignment_ref·자료에서 활용; 공지는 비워둠)
    due_date: datetime | None = None
    max_score: int | None = Field(None, ge=0, le=10000)
    topic: str | None = Field(None, max_length=100)
    attachments: list[Attachment] | None = None


class CoursePostUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    content: str | None = Field(None, min_length=1)
    post_type: PostType | None = None
    is_pinned: bool | None = None
    due_date: datetime | None = None
    max_score: int | None = Field(None, ge=0, le=10000)
    topic: str | None = Field(None, max_length=100)
    attachments: list[Attachment] | None = None


class AutoGenerateRequest(BaseModel):
    """POST /api/classroom/courses/_auto-generate

    학기 모든 교사 enrollment의 teaching_classes × teaching_subjects 조합으로
    강좌 자동 생성. 이미 존재하면 skip (멱등).
    """
    semester_id: int | None = None
    auto_enroll_students: bool = True  # 학급 단위 강좌면 자동 학생 등록
