"""스토리지 볼륨 CRUD + 헬스체크 + 자동 분산 선택 + 자동 감지.

엔드포인트:
  GET    /api/storage/volumes               — 목록 + 실시간 사용량
  GET    /api/storage/volumes/_detect       — 외부 마운트 후보 자동 감지 (admin)
  POST   /api/storage/volumes               — 볼륨 등록
  PUT    /api/storage/volumes/{id}          — 수정
  DELETE /api/storage/volumes/{id}          — 삭제
  POST   /api/storage/volumes/{id}/check    — 헬스체크 (mount 가능 여부)

자동 분산: pick_volume_for_upload() 헬퍼는 active + lowest priority + 여유 용량 우선.

자동 감지 안전망:
- 화이트리스트 prefix(/mnt /media /run/media)만 후보화 → root/홈/시스템 등록 차단
- tmpfs / proc / sysfs / cgroup / devtmpfs / squashfs 등 시스템 fstype 자동 제외
- 이미 등록된 path는 already_registered=True 표시 (UI에서 회색)
- /proc/mounts 없는 환경(macOS dev 등)은 빈 list 반환
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


# NFS 마운트 끊김 시 os.path.exists / shutil.disk_usage가 무한 hang 가능 →
# 강제 5초 컷. 정상 LAN NFS면 metadata 호출은 <100ms.
_CHECK_PATH_TIMEOUT_SEC = 5.0


async def _check_path(path: str) -> tuple[str, int, int]:
    """비동기 + 타임아웃. 타임아웃 시 ("timeout", 0, 0) 반환 — fail-soft.

    pick_volume_for_upload 등에서 매 업로드마다 호출되므로 hang은 치명적.
    timeout 시 그 볼륨을 부적합으로 간주하고 다음 후보로 fallthrough.
    """
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(_check_path_sync, path),
            timeout=_CHECK_PATH_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        import logging
        logging.getLogger(__name__).error(
            "storage_volumes._check_path: TIMEOUT after %.1fs on %s — mount may be hung",
            _CHECK_PATH_TIMEOUT_SEC, path,
        )
        return ("timeout", 0, 0)


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
    # 병렬 health check — 한 볼륨이 hang(5s timeout)해도 전체 응답이 5초 안에 끝남.
    # 순차면 N개 모두 timeout 시 5N초 걸림.
    checks = await asyncio.gather(*[_check_path(v.path) for v in rows])
    items = [
        _to_dict(v, runtime_total=total, runtime_free=free)
        for v, (st, total, free) in zip(rows, checks)
    ]
    return {"items": items}


def _normalize_path(p: str) -> str:
    """경로 정규화 — 끝 슬래시 제거 + 절대경로."""
    return os.path.normpath(os.path.abspath(p))


@router.post("/volumes")
async def create_volume(
    body: VolumeCreate,
    request: Request,
    user: User = Depends(require_permission("storage.volume.manage")),
    db: AsyncSession = Depends(get_db),
):
    # name 중복 차단
    dup = (await db.execute(
        select(StorageVolume).where(StorageVolume.name == body.name)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "이미 등록된 이름")
    # path 정규화 + 중복 차단 (서로 다른 표기지만 같은 디렉터리 가리키는 경우 잡음)
    normalized = _normalize_path(body.path)
    path_dup = (await db.execute(
        select(StorageVolume).where(StorageVolume.path == normalized)
    )).scalar_one_or_none()
    if path_dup:
        raise HTTPException(409, f"이미 등록된 경로 (볼륨: {path_dup.name})")
    st, total, free = await _check_path(normalized)
    if st == "missing":
        raise HTTPException(400, f"경로 없음: {normalized}")
    v = StorageVolume(
        name=body.name,
        description=body.description,
        path=normalized,
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
    if body.path is not None:
        new_path = _normalize_path(body.path)
        if new_path != v.path:
            # 변경 시 다른 볼륨과 충돌 차단
            other = (await db.execute(
                select(StorageVolume).where(
                    StorageVolume.path == new_path,
                    StorageVolume.id != vid,
                )
            )).scalar_one_or_none()
            if other:
                raise HTTPException(409, f"이미 등록된 경로 (볼륨: {other.name})")
            v.path = new_path
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


# ─────────────────────────────────────────────────────────────────────────────
# 자동 감지 — /proc/mounts 파싱 후 안전 prefix만 후보 반환
# ─────────────────────────────────────────────────────────────────────────────

# 화이트리스트 — root/홈/시스템 디렉토리 자동 차단
_SAFE_MOUNT_PREFIXES = ("/mnt/", "/media/", "/run/media/")

# 제외 fstype — tmpfs, proc, sys 등 시스템 마운트는 후보 X
_EXCLUDED_FSTYPES = frozenset({
    "tmpfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts", "devtmpfs",
    "squashfs", "overlay", "overlayfs", "autofs", "rpc_pipefs", "binfmt_misc",
    "securityfs", "debugfs", "tracefs", "pstore", "mqueue", "hugetlbfs",
    "fusectl", "configfs", "bpf", "ramfs", "nsfs", "selinuxfs", "efivarfs",
})


def _detect_mounts_sync() -> list[dict]:
    """/proc/mounts 파싱 → 안전 prefix + 정상 fstype만 후보 list 반환."""
    candidates: list[dict] = []
    seen_paths: set[str] = set()
    try:
        with open("/proc/mounts", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                # device  mount_point  fstype  options ...
                mount_point = parts[1]
                fstype = parts[2]
                # /proc/mounts 이스케이프 디코드 (공백·탭·\)
                mount_point = (
                    mount_point.replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\134", "\\")
                )
                if fstype in _EXCLUDED_FSTYPES:
                    continue
                if fstype.startswith("fuse.gvfs"):
                    continue
                # 화이트리스트 prefix만 통과
                if not any(mount_point.startswith(p) for p in _SAFE_MOUNT_PREFIXES):
                    continue
                # prefix 본체 자체 (/mnt /media /run/media)는 후보 X
                if mount_point.rstrip("/") in {"/mnt", "/media", "/run/media"}:
                    continue
                if mount_point in seen_paths:
                    continue
                seen_paths.add(mount_point)
                if not os.path.isdir(mount_point):
                    continue
                writable = os.access(mount_point, os.W_OK)
                try:
                    usage = shutil.disk_usage(mount_point)
                except Exception:
                    continue
                candidates.append({
                    "path": mount_point,
                    "fstype": fstype,
                    "total_bytes": usage.total,
                    "used_bytes": usage.used,
                    "free_bytes": usage.free,
                    "writable": writable,
                })
    except FileNotFoundError:
        # /proc/mounts 없는 환경 (macOS dev 등) — 빈 list
        return []
    except Exception:
        return []
    candidates.sort(key=lambda x: x["total_bytes"], reverse=True)
    return candidates


async def _detect_mounts() -> list[dict]:
    return await asyncio.to_thread(_detect_mounts_sync)


@router.get("/volumes/_detect")
async def detect_volumes(
    user: User = Depends(require_permission("storage.volume.manage")),
    db: AsyncSession = Depends(get_db),
):
    """안전 prefix 외 마운트를 자동 감지 → 등록 후보 list 반환.

    응답 각 후보:
      - path, fstype, total/used/free_bytes, writable
      - already_registered: 이미 등록된 path인지 (UI에서 회색 처리)
      - recommended: 1 GB+ 용량 + writable + 미등록 → True
    """
    found = await _detect_mounts()
    existing_paths = set(
        (await db.execute(select(StorageVolume.path))).scalars().all()
    )
    items = []
    for c in found:
        items.append({
            **c,
            "already_registered": c["path"] in existing_paths,
            "recommended": (
                c["writable"]
                and c["total_bytes"] >= 1_073_741_824  # 1 GB
                and c["path"] not in existing_paths
            ),
        })
    return {"items": items}


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


# ── 운영자 헬스 진단 (NFS / 외장 SSD 통합 점검) ──

@router.get("/health")
async def storage_health(
    user: User = Depends(require_permission("storage.volume.view")),
    db: AsyncSession = Depends(get_db),
):
    """default storage root + 모든 등록 볼륨 한 번에 점검.

    운영 모니터링용. NFS 마운트가 정상인지, 외장 SSD가 detach됐는지 한 응답에서 확인.
    매 호출이 병렬 health check — 한 볼륨이 hang(5s timeout)해도 전체 5초 내 응답.

    응답 ``any_unavailable=True``이면 active 볼륨 중 하나라도 비정상 →
    UI에서 상단 배너로 경고 권장.
    """
    from app.core.files import storage_health_check
    return await storage_health_check(db)


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
