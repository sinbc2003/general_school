"""챗봇 관리자 — 전역 설정 (기본 모델·메시지 한도 등) endpoints.

router 객체는 router.py에서 공유. router.py 끝의 'from . import admin_config'로 등록.
"""

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.chatbot import ChatbotConfig
from app.models.user import User

from app.modules.chatbot.router import router, _set_config


CONFIG_KEYS = [
    "default_provider_teacher", "default_model_teacher",
    "default_provider_student", "default_model_student",
    "student_can_change_model", "teacher_can_change_model",
    "student_can_pick_prompt", "max_message_length", "max_session_messages",
]


@router.get("/config")
async def get_config(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """모든 사용자가 자기 audience 관련 설정 조회 가능 (기본 모델 등)"""
    rows = (await db.execute(select(ChatbotConfig))).scalars().all()
    cfg = {r.key: r.value for r in rows}
    # 기본값 채우기
    defaults = {
        "default_provider_teacher": "anthropic",
        "default_model_teacher": "claude-sonnet-4-6",
        "default_provider_student": "anthropic",
        "default_model_student": "claude-haiku-4-5-20251001",
        "student_can_change_model": "false",
        "teacher_can_change_model": "true",
        "student_can_pick_prompt": "false",
        "max_message_length": "8000",
        "max_session_messages": "200",
    }
    for k, v in defaults.items():
        cfg.setdefault(k, v)
    return cfg


@router.put("/config")
async def update_config(
    body: dict, request: Request,
    user: User = Depends(require_permission("chatbot.config.manage")),
    db: AsyncSession = Depends(get_db),
):
    """config 부분 업데이트. CONFIG_KEYS 화이트리스트만 허용 (의도적으로 free-form dict)."""
    for k, v in body.items():
        if k not in CONFIG_KEYS:
            continue
        await _set_config(db, k, str(v) if v is not None else "")
    await log_action(db, user, "chatbot_config_updated", target=",".join(body.keys()), request=request)
    return {"ok": True}
