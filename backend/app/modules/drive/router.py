"""내 드라이브 — 본인이 만든 협업 도구 자료 통합 조회 + 휴지통 30일 복구.

데이터 모델:
  - 4가지 협업 도구: docs / sheets / decks / surveys
  - 모두 soft delete 컬럼 (deleted_at, deleted_by, storage_bytes) 보유.
  - owner: docs/sheets/decks=owner_id, surveys=author_id

흐름:
  1. 사용자가 휴지통으로 이동 → deleted_at=now()
  2. 30일 grace → cron이 hard delete + quota release
  3. 사용자가 직접 복구하면 deleted_at=NULL
  4. 사용자가 "영구 삭제" 클릭 → hard delete 즉시 + quota release

권한: drive.use (default 부여, 모든 사용자).
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.quota import is_unlimited, release_quota
from app.models import (
    ClassroomDocument,
    ClassroomHwp,
    ClassroomPresentation,
    ClassroomSheet,
    Survey,
    User,
)


router = APIRouter(prefix="/api/drive", tags=["drive"])


# 타입 → (모델, owner_field, 표시 라벨)
ITEM_TYPES: dict[str, tuple[Any, str, str]] = {
    "docs": (ClassroomDocument, "owner_id", "문서"),
    "sheets": (ClassroomSheet, "owner_id", "스프레드시트"),
    "decks": (ClassroomPresentation, "owner_id", "프리젠테이션"),
    "surveys": (Survey, "author_id", "설문지"),
    "hwps": (ClassroomHwp, "owner_id", "HWP"),
}

# 휴지통 보관 기간
TRASH_RETENTION_DAYS = 30


def _resolve_type(type_str: str) -> tuple[Any, str, str]:
    if type_str not in ITEM_TYPES:
        raise HTTPException(404, f"알 수 없는 자료 타입: {type_str}")
    return ITEM_TYPES[type_str]


def _serialize(item: Any, type_str: str) -> dict[str, Any]:
    return {
        "id": item.id,
        "type": type_str,
        "title": item.title,
        "course_id": getattr(item, "course_id", None),
        "owner_id": getattr(item, "owner_id", None) or getattr(item, "author_id", None),
        "folder_id": getattr(item, "folder_id", None),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "deleted_at": item.deleted_at.isoformat() if item.deleted_at else None,
        "storage_bytes": item.storage_bytes or 0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 본인 quota + 사용량
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/me")
async def my_drive_info(
    user: User = Depends(require_permission("drive.use")),
):
    """본인의 quota·사용량·만료일·즐겨찾는 도구 통계."""
    quota = user.quota_bytes or 0
    used = user.used_bytes or 0
    available = max(0, quota - used) if quota > 0 else None
    ratio = (used / quota) if quota > 0 else 0.0
    expires_at = user.expires_at.isoformat() if user.expires_at else None
    days_until_expire = None
    if user.expires_at:
        # SQLite는 naive datetime으로 저장 — 호환성을 위해 UTC로 가정.
        exp = user.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        delta = exp - datetime.now(timezone.utc)
        days_until_expire = max(0, delta.days)
    return {
        "quota_bytes": quota,
        "used_bytes": used,
        "available_bytes": available,
        "usage_ratio": round(ratio, 4),
        "unlimited": is_unlimited(user),
        "expires_at": expires_at,
        "days_until_expire": days_until_expire,
        "user_type": user.user_type,
        "lifecycle_status": user.lifecycle_status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 자료 통합 목록
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/items")
async def list_my_items(
    trash: bool = False,
    type: str = "all",
    folder_id: int | None = None,
    no_folder: bool = False,
    limit: int = 200,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 자료 통합 조회.

    trash=False → 활성 자료만, trash=True → 휴지통(deleted_at IS NOT NULL).
    type='all'이면 5가지 모두, 아니면 docs|sheets|decks|surveys|hwps 중 하나.
    folder_id 지정 시 그 폴더 안 자료만. no_folder=true면 폴더 밖(루트) 자료만.
    """
    types_to_query: list[str] = (
        list(ITEM_TYPES.keys()) if type == "all" else [type]
    )
    if type != "all" and type not in ITEM_TYPES:
        raise HTTPException(400, f"잘못된 type: {type}")

    items: list[dict[str, Any]] = []
    for t in types_to_query:
        Model, owner_field, _ = ITEM_TYPES[t]
        q = select(Model).where(getattr(Model, owner_field) == user.id)
        if trash:
            q = q.where(Model.deleted_at.isnot(None))
        else:
            q = q.where(Model.deleted_at.is_(None))
        if folder_id is not None:
            q = q.where(Model.folder_id == folder_id)
        elif no_folder:
            q = q.where(Model.folder_id.is_(None))
        q = q.order_by(Model.updated_at.desc()).limit(limit)
        rows = (await db.execute(q)).scalars().all()
        items.extend(_serialize(r, t) for r in rows)

    # 정렬: 휴지통은 deleted_at, 활성은 updated_at 기준
    key = "deleted_at" if trash else "updated_at"
    items.sort(key=lambda x: (x.get(key) or ""), reverse=True)

    return {"items": items[:limit], "trash": trash, "folder_id": folder_id}


# ─────────────────────────────────────────────────────────────────────────────
# Soft delete (휴지통으로 이동)
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/items/{type}/{item_id}")
async def soft_delete_item(
    type: str,
    item_id: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """자료를 휴지통으로 이동 (deleted_at = now). owner 본인만 가능.

    quota는 그대로 유지 (휴지통 보호 기간 30일 = 차감 유지).
    """
    Model, owner_field, label = _resolve_type(type)
    obj = await db.get(Model, item_id)
    if not obj:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    if getattr(obj, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 삭제할 수 있습니다")
    if obj.deleted_at:
        raise HTTPException(400, "이미 휴지통에 있습니다")

    obj.deleted_at = datetime.now(timezone.utc)
    obj.deleted_by = user.id
    await db.flush()
    await log_action(
        db, user, "drive_soft_delete",
        target=f"{type}:{item_id}",
        detail=f"title={obj.title}",
    )
    return {"ok": True, "deleted_at": obj.deleted_at.isoformat()}


# ─────────────────────────────────────────────────────────────────────────────
# 복구
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/items/{type}/{item_id}/restore")
async def restore_item(
    type: str,
    item_id: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """휴지통에서 복구. deleted_at=NULL, deleted_by=NULL."""
    Model, owner_field, label = _resolve_type(type)
    obj = await db.get(Model, item_id)
    if not obj:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    if getattr(obj, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 복구할 수 있습니다")
    if not obj.deleted_at:
        raise HTTPException(400, "휴지통에 없는 자료입니다")

    obj.deleted_at = None
    obj.deleted_by = None
    await db.flush()
    await log_action(
        db, user, "drive_restore",
        target=f"{type}:{item_id}",
        detail=f"title={obj.title}",
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# 영구 삭제
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/items/{type}/{item_id}/permanent")
async def permanent_delete_item(
    type: str,
    item_id: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """영구 삭제 — DB row + quota 환불. 본인만 가능 (super_admin 예외)."""
    Model, owner_field, label = _resolve_type(type)
    obj = await db.get(Model, item_id)
    if not obj:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    if getattr(obj, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 영구 삭제할 수 있습니다")

    bytes_to_free = obj.storage_bytes or 0
    owner_id = getattr(obj, owner_field)
    title = obj.title
    await db.delete(obj)
    await db.flush()

    # quota 환원 (자료 소유자)
    if bytes_to_free > 0 and owner_id:
        owner = await db.get(User, owner_id)
        if owner:
            await release_quota(db, owner, bytes_to_free)

    await log_action(
        db, user, "drive_permanent_delete",
        target=f"{type}:{item_id}",
        detail=f"title={title} freed={bytes_to_free}",
    )
    return {"ok": True, "freed_bytes": bytes_to_free}


# ─────────────────────────────────────────────────────────────────────────────
# 휴지통 일괄 비우기
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/trash/empty")
async def empty_my_trash(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 휴지통의 모든 자료 영구 삭제."""
    deleted = 0
    freed_total = 0
    for t, (Model, owner_field, _) in ITEM_TYPES.items():
        q = select(Model).where(
            getattr(Model, owner_field) == user.id,
            Model.deleted_at.isnot(None),
        )
        rows = (await db.execute(q)).scalars().all()
        for obj in rows:
            freed_total += obj.storage_bytes or 0
            await db.delete(obj)
            deleted += 1
    await db.flush()

    if freed_total > 0:
        await release_quota(db, user, freed_total)

    await log_action(
        db, user, "drive_empty_trash",
        detail=f"deleted={deleted} freed={freed_total}",
    )
    return {"ok": True, "deleted_count": deleted, "freed_bytes": freed_total}


# ─────────────────────────────────────────────────────────────────────────────
# 자동 영구 삭제 cron 헬퍼 (notification_scheduler에서 호출)
# ─────────────────────────────────────────────────────────────────────────────

async def purge_expired_trash(db: AsyncSession) -> dict[str, int]:
    """30일 경과한 휴지통 자료 hard delete + quota 환원. cron에서 호출.

    returns: {deleted_total: N, freed_bytes_total: B}
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=TRASH_RETENTION_DAYS)
    total_deleted = 0
    total_freed = 0
    # owner별로 quota 환원량 집계 (개별 release 호출보다 효율적)
    freed_by_owner: dict[int, int] = {}

    for t, (Model, owner_field, _) in ITEM_TYPES.items():
        q = select(Model).where(
            Model.deleted_at.isnot(None),
            Model.deleted_at < cutoff,
        )
        rows = (await db.execute(q)).scalars().all()
        for obj in rows:
            owner_id = getattr(obj, owner_field)
            bytes_freed = obj.storage_bytes or 0
            if owner_id and bytes_freed > 0:
                freed_by_owner[owner_id] = freed_by_owner.get(owner_id, 0) + bytes_freed
            total_freed += bytes_freed
            await db.delete(obj)
            total_deleted += 1
    await db.flush()

    # owner별 quota 환원
    if freed_by_owner:
        for uid, freed in freed_by_owner.items():
            owner = await db.get(User, uid)
            if owner:
                await release_quota(db, owner, freed)

    return {"deleted_total": total_deleted, "freed_bytes_total": total_freed}


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.drive import folders  # noqa: E402, F401
from app.modules.drive import backup  # noqa: E402, F401
from app.modules.drive import search  # noqa: E402, F401
