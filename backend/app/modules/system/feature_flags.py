"""Feature Flag 관리 endpoints — super_admin 전용.

GET /api/system/feature-flags            — 모든 flag 목록 + 메타 (UI용)
PUT /api/system/feature-flags/{key}      — status 변경
POST /api/system/feature-flags/seed      — 알려진 flag 시드 (부팅 시 자동)
GET /api/me/features                     — 현재 사용자에게 활성 기능 dict

설계: super_admin이 UI에서 학교별로 ON/OFF.
"""

from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.features import (
    get_effective_features,
    list_all_features_with_meta,
    seed_known_features,
    set_feature_status,
)
from app.core.permissions import require_permission
from app.models.user import User
from app.modules.system.router import router


class FeatureUpdate(BaseModel):
    status: Literal["off", "admin_only", "on"]


@router.get("/feature-flags")
async def list_feature_flags(
    user: User = Depends(require_permission("system.feature_flags.manage")),
    db: AsyncSession = Depends(get_db),
):
    """모든 feature flag + 메타 (label/category/description)."""
    items = await list_all_features_with_meta(db)
    # 카테고리별 정렬
    items.sort(key=lambda x: (x["category"], x["label"]))
    return {"items": items}


@router.put("/feature-flags/{key}")
async def update_feature_flag(
    key: str,
    body: FeatureUpdate,
    request: Request,
    user: User = Depends(require_permission("system.feature_flags.manage")),
    db: AsyncSession = Depends(get_db),
):
    """flag status 변경."""
    flag = await set_feature_status(db, key, body.status, user_id=user.id)
    await log_action(
        db, user, "feature_flag_update",
        target=key,
        detail=f"status={body.status}",
        request=request,
    )
    return {"ok": True, "key": flag.key, "status": flag.status}


@router.post("/feature-flags/_seed")
async def seed_features_now(
    user: User = Depends(require_permission("system.feature_flags.manage")),
    db: AsyncSession = Depends(get_db),
):
    """KNOWN_FEATURES 자동 시드 (수동 trigger). 부팅 시 자동 호출도 됨."""
    added = await seed_known_features(db)
    return {"added": added}
