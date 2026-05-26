"""강좌별 챗봇 CRUD — Phase 3.

Google Classroom의 Gem 동등 — 강좌마다 시스템 프롬프트 + (옵션) 모델 지정.
학생/교사가 강좌 페이지의 챗봇 카드 클릭 시 그 system_prompt가 적용된
ChatSession이 자동 생성됨.

설계:
- 강좌 editor(owner/co_teacher) + admin: CRUD 가능
- 강좌 멤버(수강생 포함): list/get만 가능
- provider/model_id null이면 chatbot_config 기본값 fallback
- 학생용 가드레일 system prompt는 sessions.py에서 별도 prepend (변경 X)

router 객체는 router.py에서 공유. router.py 끝의 'from . import chatbots'로 등록.
"""

from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    ChatSession,
    Course,
    CourseChatbot,
    CourseStudent,
    User,
)
from app.modules.classroom.router import router
from app.modules.classroom.teachers import is_course_editor, is_course_editor_or_admin


# ─────────────────────────────────────────────────────────────────────────────
# 스키마
# ─────────────────────────────────────────────────────────────────────────────


class ContextAttachment(BaseModel):
    """챗봇 참고 자료 항목 — start-session 시 system_prompt에 본문 자동 주입.

    {"type": "doc"|"sheet"|"deck"|"hwp", "id": 42, "title": "..."}
    각 type별로 본문 추출 방식이 다름 (services/chatbot_context.py 참조).
    """
    type: Literal["doc", "sheet", "deck", "hwp"]
    id: int = Field(..., gt=0)
    title: str = Field(..., min_length=1, max_length=255)


class ChatbotCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    system_prompt: str = Field(..., min_length=1, max_length=20000)
    provider: str | None = Field(None, max_length=30)
    model_id: str | None = Field(None, max_length=150)
    is_active: bool = True
    # 자동 주입할 강좌 자료 — 자료당 max 5000자, 전체 30KB 한도 (start-session에서 잘림)
    context_attachments: list[ContextAttachment] | None = Field(default=None, max_length=10)


class ChatbotUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    system_prompt: str | None = Field(None, min_length=1, max_length=20000)
    provider: str | None = Field(None, max_length=30)
    model_id: str | None = Field(None, max_length=150)
    is_active: bool | None = None
    context_attachments: list[ContextAttachment] | None = Field(default=None, max_length=10)


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────


def _to_dict(b: CourseChatbot) -> dict:
    return {
        "id": b.id,
        "course_id": b.course_id,
        "name": b.name,
        "description": b.description,
        "system_prompt": b.system_prompt,
        "provider": b.provider,
        "model_id": b.model_id,
        "is_active": b.is_active,
        "context_attachments": b.context_attachments or [],
        "created_by": b.created_by,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


async def _is_course_member(db: AsyncSession, user: User, course: Course) -> bool:
    """강좌 멤버(교사/학생/admin) 검증."""
    # admin + owner + co_teacher (SSOT) → editor_or_admin
    if await is_course_editor_or_admin(db, course, user):
        return True
    # 학생 active 수강생
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    return cs is not None


async def _is_course_admin(db: AsyncSession, user: User, course: Course) -> bool:
    """챗봇 CRUD 권한 — editor + admin만."""
    return await is_course_editor_or_admin(db, course, user)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/courses/{cid}/chatbots")
async def list_course_chatbots(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """강좌 챗봇 list (강좌 멤버 모두 접근)."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_member(db, user, course):
        raise HTTPException(403, "강좌 멤버만 볼 수 있습니다")

    rows = (await db.execute(
        select(CourseChatbot)
        .where(CourseChatbot.course_id == cid)
        .order_by(CourseChatbot.id)
    )).scalars().all()
    return {"items": [_to_dict(b) for b in rows]}


@router.post("/courses/{cid}/chatbots")
async def create_course_chatbot(
    cid: int,
    body: ChatbotCreate,
    request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """챗봇 생성 — 강좌 editor + admin만."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_admin(db, user, course):
        raise HTTPException(403, "강좌 교사만 챗봇을 만들 수 있습니다")

    b = CourseChatbot(
        course_id=cid,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
        provider=body.provider,
        model_id=body.model_id,
        is_active=body.is_active,
        context_attachments=(
            [a.model_dump() for a in body.context_attachments]
            if body.context_attachments else None
        ),
        created_by=user.id,
    )
    db.add(b)
    await db.flush()
    await log_action(
        db, user, "classroom.chatbot.create",
        target=f"course_chatbot:{b.id}",
        request=request,
    )
    return _to_dict(b)


@router.get("/chatbots/{bid}")
async def get_course_chatbot(
    bid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """챗봇 단일 조회 — 강좌 멤버만."""
    b = await db.get(CourseChatbot, bid)
    if not b:
        raise HTTPException(404, "챗봇 없음")
    course = await db.get(Course, b.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_member(db, user, course):
        raise HTTPException(403, "강좌 멤버만 볼 수 있습니다")
    return _to_dict(b)


@router.put("/chatbots/{bid}")
async def update_course_chatbot(
    bid: int,
    body: ChatbotUpdate,
    request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """챗봇 수정 — 강좌 editor + admin만."""
    b = await db.get(CourseChatbot, bid)
    if not b:
        raise HTTPException(404, "챗봇 없음")
    course = await db.get(Course, b.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_admin(db, user, course):
        raise HTTPException(403, "강좌 교사만 챗봇을 수정할 수 있습니다")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(b, k, v)
    # JSON column이 list[ContextAttachment] 그대로 받아도 model_dump로 이미 dict 변환됨.
    await db.flush()
    await log_action(
        db, user, "classroom.chatbot.update",
        target=f"course_chatbot:{bid}",
        request=request,
    )
    return _to_dict(b)


@router.post("/chatbots/{bid}/start-session")
async def start_chatbot_session(
    bid: int,
    request: Request,
    user: User = Depends(require_permission("chatbot.use")),
    db: AsyncSession = Depends(get_db),
):
    """챗봇으로 새 ChatSession 시작 — 강좌 멤버만.

    - chatbot.system_prompt를 ChatSession.system_prompt_text에 inline 저장
    - chatbot.provider/model_id가 있으면 사용, 없으면 chatbot_config 기본값
    - audience는 자동 (학생 → student, 교사 → teacher) — 학생용 가드레일 호환
    - 응답: { session_id } — frontend는 /chat 또는 /s/chat 페이지로 이동
    """
    b = await db.get(CourseChatbot, bid)
    if not b or not b.is_active:
        raise HTTPException(404, "챗봇 없음 또는 비활성")
    course = await db.get(Course, b.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_member(db, user, course):
        raise HTTPException(403, "강좌 멤버만 챗봇을 사용할 수 있습니다")

    # provider/model_id 결정 — chatbot 지정값 우선, 없으면 audience별 기본
    from sqlalchemy import select as sa_select
    from app.models import ChatbotConfig

    audience = "student" if user.role == "student" else (
        "admin" if user.role in ("super_admin", "designated_admin") else "teacher"
    )

    async def _get_config(key: str, default: str = "") -> str:
        cfg = (await db.execute(
            sa_select(ChatbotConfig).where(ChatbotConfig.key == key)
        )).scalar_one_or_none()
        return (cfg.value or default) if cfg else default

    provider = b.provider or await _get_config(
        f"default_provider_{'student' if audience == 'student' else 'teacher'}", ""
    )
    model_id = b.model_id or await _get_config(
        f"default_model_{'student' if audience == 'student' else 'teacher'}", ""
    )
    if not provider or not model_id:
        raise HTTPException(
            400, "provider/model이 설정되지 않았습니다. 관리자가 챗봇 모델을 지정해야 합니다.",
        )

    # context_attachments가 있으면 강좌 자료 본문을 추출해 system_prompt 앞에 prepend.
    # (자료당 5000자, 전체 30KB 한도; 헬퍼 services/chatbot_context.py 참조)
    from app.services.chatbot_context import build_context_text
    context_text = await build_context_text(db, b.context_attachments)
    final_prompt = (
        f"{context_text}\n\n--- 시스템 지시 ---\n{b.system_prompt}"
        if context_text else b.system_prompt
    )

    s = ChatSession(
        user_id=user.id,
        title=f"💬 {b.name}",
        audience=audience,
        provider=provider,
        model_id=model_id,
        system_prompt_id=None,
        system_prompt_text=final_prompt,
        source_chatbot_id=b.id,
    )
    db.add(s)
    await db.flush()

    await log_action(
        db, user, "classroom.chatbot.session_start",
        target=f"course_chatbot:{bid}",
        request=request,
    )

    return {
        "session_id": s.id,
        "title": s.title,
        "provider": s.provider,
        "model_id": s.model_id,
        "chatbot_id": b.id,
        "chatbot_name": b.name,
    }


@router.delete("/chatbots/{bid}")
async def delete_course_chatbot(
    bid: int,
    request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    """챗봇 삭제 — 강좌 editor + admin만."""
    b = await db.get(CourseChatbot, bid)
    if not b:
        raise HTTPException(404, "챗봇 없음")
    course = await db.get(Course, b.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await _is_course_admin(db, user, course):
        raise HTTPException(403, "강좌 교사만 챗봇을 삭제할 수 있습니다")

    await db.delete(b)
    await log_action(
        db, user, "classroom.chatbot.delete",
        target=f"course_chatbot:{bid}",
        request=request,
    )
    return {"ok": True}
