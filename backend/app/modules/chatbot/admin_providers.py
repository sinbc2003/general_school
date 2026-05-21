"""챗봇 관리자 — LLM provider 관리 endpoints.

list / upsert / connection test.
router 객체는 router.py에서 공유. router.py 끝의 'from . import admin_providers'로 등록.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.encryption import decrypt, encrypt, mask_secret
from app.core.permissions import require_permission
from app.models.chatbot import LLMProvider
from app.models.user import User
from app.services.llm.registry import (
    SUPPORTED_PROVIDERS, invalidate_cache, make_adapter,
)

from app.modules.chatbot.router import router
from app.modules.chatbot.schemas import ProviderUpsert


@router.get("/providers")
async def list_providers(
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(LLMProvider).order_by(LLMProvider.provider))).scalars().all()
    existing = {r.provider for r in rows}
    items = []
    for r in rows:
        api_key_plain = decrypt(r.api_key_encrypted) if r.api_key_encrypted else ""
        items.append({
            "provider": r.provider,
            "is_active": r.is_active,
            "api_key_masked": mask_secret(api_key_plain) if api_key_plain else "",
            "has_key": bool(api_key_plain),
            "last_tested_at": r.last_tested_at.isoformat() if r.last_tested_at else None,
            "last_test_ok": r.last_test_ok,
            "last_test_error": r.last_test_error,
            "notes": r.notes,
        })
    # 미등록 provider도 placeholder로 노출
    for p in SUPPORTED_PROVIDERS:
        if p not in existing:
            items.append({
                "provider": p, "is_active": False, "api_key_masked": "",
                "has_key": False, "last_tested_at": None, "last_test_ok": False,
                "last_test_error": None, "notes": None,
            })
    items.sort(key=lambda x: SUPPORTED_PROVIDERS.index(x["provider"]) if x["provider"] in SUPPORTED_PROVIDERS else 99)
    return {"items": items, "supported": SUPPORTED_PROVIDERS}


@router.put("/providers/{provider}")
async def upsert_provider(
    provider: str, body: ProviderUpsert, request: Request,
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    """provider 키·활성 상태 부분 업데이트. api_key가 None/빈 문자열이면 변경 안 함."""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"지원하지 않는 provider: {provider}")

    p = (await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))).scalar_one_or_none()
    if not p:
        p = LLMProvider(provider=provider)
        db.add(p)

    patch = body.model_dump(exclude_unset=True)
    if patch.get("api_key"):
        p.api_key_encrypted = encrypt(patch["api_key"].strip())
        p.last_tested_at = None
        p.last_test_ok = False
        p.last_test_error = None
    if "is_active" in patch:
        p.is_active = bool(patch["is_active"])
    if "notes" in patch:
        p.notes = patch["notes"]
    if "default_model_id" in patch and hasattr(p, "default_model_id"):
        p.default_model_id = patch["default_model_id"]

    await db.flush()
    invalidate_cache(provider)
    await log_action(db, user, "llm_provider_updated", target=provider, request=request)
    return {"ok": True}


@router.post("/providers/{provider}/test")
async def test_provider(
    provider: str,
    user: User = Depends(require_permission("chatbot.provider.manage")),
    db: AsyncSession = Depends(get_db),
):
    """저장된 키로 핸드셰이크 테스트"""
    p = (await db.execute(select(LLMProvider).where(LLMProvider.provider == provider))).scalar_one_or_none()
    if not p or not p.api_key_encrypted:
        raise HTTPException(400, "API 키가 등록되지 않았습니다")
    api_key = decrypt(p.api_key_encrypted)
    adapter = make_adapter(provider, api_key)
    if not adapter:
        raise HTTPException(500, "어댑터 생성 실패")
    ok, err = await adapter.test_connection()
    p.last_tested_at = datetime.now(timezone.utc)
    p.last_test_ok = ok
    p.last_test_error = err
    return {"ok": ok, "error": err}
