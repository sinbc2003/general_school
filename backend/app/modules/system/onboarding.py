"""온보딩 마법사 API.

상태는 SchoolConfig 키-밸류 스토어에 저장.
키:
  - onboarding.completed_at   — 완료 시각 (ISO, 있으면 마법사 자동 노출 안 함)
  - onboarding.last_step      — 마지막으로 머문 단계 번호 (재진입 시 복원)
  - school.name               — 학교명
  - school.type               — 초/중/고
  - school.grade_count        — 학년 수 (default 3)

엔드포인트:
  GET  /api/system/onboarding/status   — 현재 상태 + 학교 정보 + 진행 단계
  POST /api/system/onboarding/school   — 학교 정보 저장
  POST /api/system/onboarding/step     — 현재 단계 번호 저장 (재진입용)
  POST /api/system/onboarding/complete — 완료 마크
  POST /api/system/onboarding/reset    — 다시 보기 (completed_at 제거, 단계 초기화)

router 객체는 router.py에서 공유. router.py 끝의 'from . import onboarding'으로 등록.
권한: super_admin 전용.
"""

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_super_admin
from app.models import User
from app.models.setting import SchoolConfig
from app.modules.system.router import router


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────


class SchoolInfo(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field("high", pattern="^(elem|mid|high)$")
    grade_count: int = Field(3, ge=1, le=6)


class StepBody(BaseModel):
    step: int = Field(..., ge=0, le=10)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _get_config(db: AsyncSession, key: str) -> str | None:
    row = (
        await db.execute(select(SchoolConfig).where(SchoolConfig.key == key))
    ).scalar_one_or_none()
    return row.value if row else None


async def _set_config(db: AsyncSession, key: str, value: str | None) -> None:
    row = (
        await db.execute(select(SchoolConfig).where(SchoolConfig.key == key))
    ).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(SchoolConfig(key=key, value=value, encrypted=False))
    await db.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/onboarding/status")
async def get_status(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """온보딩 진행 상태 + 학교 정보."""
    completed_at = await _get_config(db, "onboarding.completed_at")
    last_step = await _get_config(db, "onboarding.last_step")
    school_name = await _get_config(db, "school.name")
    school_type = await _get_config(db, "school.type")
    grade_count = await _get_config(db, "school.grade_count")
    return {
        "completed_at": completed_at,
        "last_step": int(last_step) if last_step and last_step.isdigit() else 0,
        "school": {
            "name": school_name,
            "type": school_type or "high",
            "grade_count": int(grade_count) if grade_count and grade_count.isdigit() else 3,
        },
    }


@router.post("/onboarding/school")
async def save_school_info(
    body: SchoolInfo,
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """학교 정보 저장 (마법사 1단계)."""
    await _set_config(db, "school.name", body.name)
    await _set_config(db, "school.type", body.type)
    await _set_config(db, "school.grade_count", str(body.grade_count))
    await log_action(
        db, user, "onboarding_school",
        detail=f"name={body.name} type={body.type} grades={body.grade_count}",
        request=request,
    )
    return {"ok": True}


@router.post("/onboarding/step")
async def save_step(
    body: StepBody,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """현재 단계 저장 (마법사 닫고 다시 열 때 복원용)."""
    await _set_config(db, "onboarding.last_step", str(body.step))
    return {"ok": True, "step": body.step}


@router.post("/onboarding/complete")
async def mark_complete(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """마법사 완료 마크 — 다음부터 자동 노출 안 함."""
    now = datetime.now(timezone.utc).isoformat()
    await _set_config(db, "onboarding.completed_at", now)
    await log_action(db, user, "onboarding_complete", request=request)
    return {"ok": True, "completed_at": now}


@router.post("/onboarding/reset")
async def reset_onboarding(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """마법사 다시 보기 — completed_at 제거 + last_step 초기화. 데이터는 보존."""
    await _set_config(db, "onboarding.completed_at", None)
    await _set_config(db, "onboarding.last_step", "0")
    await log_action(db, user, "onboarding_reset", request=request)
    return {"ok": True}
