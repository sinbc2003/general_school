"""스토리지 볼륨 CRUD + 헬스체크 + 자동 분산 선택.

엔드포인트:
  GET    /api/storage/volumes               — 목록 + 실시간 사용량
  POST   /api/storage/volumes               — 볼륨 등록
  PUT    /api/storage/volumes/{id}          — 수정
  DELETE /api/storage/volumes/{id}          — 삭제
  POST   /api/storage/volumes/{id}/check    — 헬스체크 (mount 가능 여부)

자동 분산: pick_volume_for_upload() 헬퍼는 active + lowest priority + 여유 용량 우선.
"""

import asyncio
import os
import shutil
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import StorageVolume, User


router = APIRouter(prefix="/api/storage", tags=["storage"])


class VolumeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    path: str = Field(..., min_length=1, max_length=500)
    capacity_bytes: int = Field(default=0, ge=0)
    priority: int = Field(default=100, ge=0)


class VolumeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    path: str | None = None
    capacity_bytes: int | None = None
    is_active: bool | None = None
    priority: int | None = None


def _check_path_sync(path: str) -> tuple[str, int, int]:
    """sync — mount 가능 여부 + disk usage. (status, total, free)"""
    try:
        if not os.path.exists(path):
            return ("missing", 0, 0)
        if not os.path.isdir(path):
            return ("error", 0, 0)
        # 쓰기 가능 테스트
        if not os.access(path, os.W_OK):
            return ("readonly", 0, 0)
        usage = shutil.disk_usage(path)
        return ("mounted", usage.total, usage.free)
    except Exception:
        return ("error", 0, 0)


async def _check_path(path: str) -> tuple[str, int, int]:
    return await asyncio.to_thread(_check_path_sync, path)


def _to_dict(v: StorageVolume, runtime_total: int | None = None, runtime_free: int | None = None) -> dict:
    return {
        "id": v.id,
        "name": v.name,
        "description": v.description,
        "path": v.path,
        "capacity_bytes": v.capacity_bytes,
        "used_bytes": v.used_bytes,
        "available_bytes": (runtime_free if runtime_free is not None
                            else max(0, v.capacity_bytes - (v.used_bytes or 0))),
        "runtime_total_bytes": runtime_total,
        "runtime_free_bytes": runtime_free,
        "is_active": v.is_active,
        "priority": v.priority,
        "last_status": v.last_status,
        "last_checked_at": v.last_checked_at.isoformat() if v.last_checked_at else None,
    }


@router.get("/volumes")
async def list_volumes(
    user: User = Depends(require_permission("storage.volume.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(StorageVolume).order_by(StorageVolume.priority, StorageVolume.name)
    )).scalars().all()
    items = []
    for v in rows:
        st, total, free = await _check_path(v.path)
        items.append(_to_dict(v, runtime_total=total, runtime_free=free))
    return {"items": items}


@router.post("/volumes")
async def create_volume(
    body: VolumeCreate,
    request: Request,
    user: User = Depends(require_permission("storage.volume.manage")),
    db: AsyncSession = Depends(get_db),
):
    dup = (await db.execute(
        select(StorageVolume).where(StorageVolume.name == body.name)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "이미 등록된 이름")
    st, total, free = await _check_path(body.path)
    if st == "missing":
        raise HTTPException(400, f"경로 없음: {body.path}")
    v = StorageVolume(
        name=body.name,
        description=body.description,
        path=body.path,
        capacity_bytes=body.capacity_bytes or total,
        priority=body.priority,
        last_status=st,
        last_checked_at=datetime.now(timezone.utc),
    )
    db.add(v)
    await db.flush()
    await log_action(db, user, "storage_volume_create", target=v.name, request=request)
    return _to_dict(v, runtime_total=total, runtime_free=free)


@router.put("/volumes/{vid}")
async def update_volume(
    vid: int,
    body: VolumeUpdate,
    request: Request,
    user: User = Depends(require_permission("storage.volume.manage")),
    db: AsyncSession = Depends(get_db),
):
    v = await db.get(StorageVolume, vid)
    if not v:
        raise HTTPException(404, "볼륨 없음")
    if body.name is not None: v.name = body.name
    if body.description is not None: v.description = body.description
    if body.path is not None: v.path = body.path
    if body.capacity_bytes is not None: v.capacity_bytes = body.capacity_bytes
    if body.is_active is not None: v.is_active = body.is_active
    if body.priority is not None: v.priority = body.priority
    await db.flush()
    await log_action(db, user, "storage_volume_update", target=v.name, request=request)
    return _to_dict(v)


@router.delete("/volumes/{vid}")
async def delete_volume(
    vid: int,
    request: Request,
    user: User = Depends(require_permission("storage.volume.manage")),
    db: AsyncSession = Depends(get_db),
):
    v = await db.get(StorageVolume, vid)
    if not v:
        raise HTTPException(404, "볼륨 없음")
    name = v.name
    await db.delete(v)
    await db.flush()
    await log_action(db, user, "storage_volume_delete", target=name, request=request)
    return {"ok": True}


@router.post("/volumes/{vid}/check")
async def check_volume(
    vid: int,
    user: User = Depends(require_permission("storage.volume.view")),
    db: AsyncSession = Depends(get_db),
):
    v = await db.get(StorageVolume, vid)
    if not v:
        raise HTTPException(404, "볼륨 없음")
    st, total, free = await _check_path(v.path)
    v.last_status = st
    v.last_checked_at = datetime.now(timezone.utc)
    if total and v.capacity_bytes == 0:
        v.capacity_bytes = total
    await db.flush()
    return _to_dict(v, runtime_total=total, runtime_free=free)


# ── 헬퍼 (Phase 1.0 upload 로직 통합 전 단계) ──

async def pick_volume_for_upload(
    db: AsyncSession, required_bytes: int = 0,
) -> StorageVolume | None:
    """업로드 시 사용할 active 볼륨 자동 선택.

    우선순위:
      1. is_active=True
      2. priority 낮은 순 (먼저 채움)
      3. 여유 용량 충분 (used + required <= capacity)
    """
    rows = (await db.execute(
        select(StorageVolume).where(StorageVolume.is_active == True).order_by(
            StorageVolume.priority, StorageVolume.id,
        )
    )).scalars().all()
    for v in rows:
        cap = v.capacity_bytes or 0
        used = v.used_bytes or 0
        if cap <= 0 or (used + required_bytes) <= cap:
            # 실시간 free 확인 (mount 깨졌는지 미리 알 수 있게)
            st, _, free = await _check_path(v.path)
            if st == "mounted" and (free <= 0 or free >= required_bytes):
                return v
    return None
