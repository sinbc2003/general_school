"""드라이브 폴더 CRUD + 자료 이동 + 일괄 동기화.

엔드포인트 (router.py의 router 객체에 등록):
  GET    /api/drive/folders                   본인 폴더 list (전체 평탄)
  GET    /api/drive/folders/{fid}             단일 폴더 (자식 + breadcrumb 포함)
  POST   /api/drive/folders                   수동 폴더 생성
  PATCH  /api/drive/folders/{fid}             폴더 이름 변경 / 이동
  DELETE /api/drive/folders/{fid}             폴더 삭제 (자료의 folder_id는 NULL로)

  POST   /api/drive/items/{type}/{item_id}/move   자료 폴더 이동
  POST   /api/drive/folders/_sync                 본인 자동 폴더 즉시 동기화
  POST   /api/drive/folders/_sync-all             [admin] 전체 사용자 일괄 동기화

원칙:
  - 본인 폴더만 (owner_id == user.id). admin도 다른 사용자 폴더 직접 변경 X (sync-all 외).
  - 잠금 폴더(is_system_locked=True): 이름변경/삭제/이동 모두 409.
  - 다단계 중첩 허용. 부모와 자식이 같은 owner여야 함.
  - 이름 중복 허용 (사용자 자유).
  - 폴더 삭제 시 자식 폴더와 자료는 cascade ondelete=SET NULL — 자료 folder_id=NULL.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    ClassroomDocument,
    ClassroomHwp,
    ClassroomPresentation,
    ClassroomSheet,
    Folder,
    Survey,
    User,
)
from app.modules.drive.router import ITEM_TYPES, router


# ─────────────────────────────────────────────────────────────────────────────
# 유틸 — 직렬화 / 폴더 권한 검사
# ─────────────────────────────────────────────────────────────────────────────


def _folder_to_dict(f: Folder) -> dict[str, Any]:
    return {
        "id": f.id,
        "owner_id": f.owner_id,
        "parent_id": f.parent_id,
        "name": f.name,
        "auto_kind": f.auto_kind,
        "semester_id": f.semester_id,
        "source_kind": f.source_kind,
        "source_id": f.source_id,
        "sort_order": f.sort_order,
        "is_system_locked": f.is_system_locked,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


async def _assert_my_folder(db: AsyncSession, user: User, fid: int) -> Folder:
    f = await db.get(Folder, fid)
    if not f or f.deleted_at is not None:
        raise HTTPException(404, "폴더를 찾을 수 없습니다")
    if f.owner_id != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인 폴더만 접근할 수 있습니다")
    return f


async def _assert_writable(folder: Folder) -> None:
    if folder.is_system_locked:
        raise HTTPException(
            409, "자동 생성된 폴더는 이름변경·이동·삭제를 할 수 없습니다",
        )


async def _path_breadcrumb(db: AsyncSession, folder: Folder) -> list[dict[str, Any]]:
    """주어진 폴더의 root → 자신 경로."""
    chain: list[Folder] = [folder]
    cur = folder
    # 깊이 제한 (cycle 방지 + 안전)
    for _ in range(64):
        if cur.parent_id is None:
            break
        parent = await db.get(Folder, cur.parent_id)
        if not parent or parent.deleted_at is not None:
            break
        chain.append(parent)
        cur = parent
    chain.reverse()
    return [{"id": f.id, "name": f.name} for f in chain]


async def _has_descendant(
    db: AsyncSession, candidate_descendant_id: int, ancestor_id: int,
) -> bool:
    """ancestor → descendant 관계 확인. cycle 방지용 (이동 시).

    candidate_descendant_id가 ancestor_id의 자손이면 True.
    """
    if candidate_descendant_id == ancestor_id:
        return True
    cur_id: int | None = candidate_descendant_id
    for _ in range(64):
        if cur_id is None:
            return False
        cur = await db.get(Folder, cur_id)
        if not cur:
            return False
        if cur.parent_id == ancestor_id:
            return True
        cur_id = cur.parent_id
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────


class FolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: int | None = None


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: int | None = None  # None=root, -1=변경 안 함 표현 X (parent_id 키 자체 omit)
    sort_order: int | None = None


class MoveItemReq(BaseModel):
    folder_id: int | None = None  # None=root (폴더 밖)


# ─────────────────────────────────────────────────────────────────────────────
# 본인 폴더 list (전체 평탄)
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/folders")
async def list_my_folders(
    parent_id: int | None = None,
    include_locked: bool = True,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 폴더 list.

    parent_id 미지정 시 전체. parent_id=0 또는 -1은 X — 명시 안 하면 전체.
    parent_id 명시(0 포함 안 됨, -1 안 됨)이면 그 부모 하위 직속 자식만.
    """
    q = select(Folder).where(
        Folder.owner_id == user.id,
        Folder.deleted_at.is_(None),
    )
    if parent_id is not None:
        q = q.where(Folder.parent_id == parent_id) if parent_id > 0 else q.where(Folder.parent_id.is_(None))
    if not include_locked:
        q = q.where(Folder.is_system_locked == False)  # noqa: E712
    q = q.order_by(Folder.parent_id.nulls_first(), Folder.sort_order, Folder.id)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_folder_to_dict(f) for f in rows]}


# ─────────────────────────────────────────────────────────────────────────────
# 단일 폴더 + 자식 + breadcrumb
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/folders/{fid}")
async def get_folder(
    fid: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    folder = await _assert_my_folder(db, user, fid)
    children = (await db.execute(
        select(Folder).where(
            Folder.parent_id == fid,
            Folder.deleted_at.is_(None),
        ).order_by(Folder.sort_order, Folder.id)
    )).scalars().all()
    breadcrumb = await _path_breadcrumb(db, folder)
    return {
        **_folder_to_dict(folder),
        "children": [_folder_to_dict(c) for c in children],
        "breadcrumb": breadcrumb,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 수동 폴더 생성
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/folders")
async def create_folder(
    body: FolderCreate,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    parent: Folder | None = None
    if body.parent_id:
        parent = await _assert_my_folder(db, user, body.parent_id)

    if parent is not None:
        max_order = (await db.execute(
            select(Folder.sort_order).where(
                Folder.parent_id == parent.id,
                Folder.deleted_at.is_(None),
            ).order_by(Folder.sort_order.desc()).limit(1)
        )).scalar_one_or_none() or 0
    else:
        max_order = (await db.execute(
            select(Folder.sort_order).where(
                Folder.owner_id == user.id,
                Folder.parent_id.is_(None),
                Folder.deleted_at.is_(None),
            ).order_by(Folder.sort_order.desc()).limit(1)
        )).scalar_one_or_none() or 0

    folder = Folder(
        owner_id=user.id,
        parent_id=parent.id if parent else None,
        name=body.name.strip(),
        sort_order=int(max_order) + 1,
        is_system_locked=False,
    )
    db.add(folder)
    await db.flush()
    await log_action(
        db, user, "drive.folder.create",
        target=f"folder:{folder.id}",
        detail=f"name={folder.name} parent={folder.parent_id}",
    )
    return _folder_to_dict(folder)


# ─────────────────────────────────────────────────────────────────────────────
# 폴더 이름변경 / 이동 / sort_order
# ─────────────────────────────────────────────────────────────────────────────


@router.patch("/folders/{fid}")
async def update_folder(
    fid: int,
    body: FolderUpdate,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    folder = await _assert_my_folder(db, user, fid)
    await _assert_writable(folder)

    patch = body.model_dump(exclude_unset=True)

    if "name" in patch and patch["name"] is not None:
        folder.name = patch["name"].strip()

    if "parent_id" in patch:
        new_parent_id = patch["parent_id"]
        # cycle 방지: 새 parent가 본인 또는 자손이면 X
        if new_parent_id is not None:
            if new_parent_id == fid:
                raise HTTPException(400, "자기 자신을 부모로 지정할 수 없습니다")
            parent = await _assert_my_folder(db, user, new_parent_id)
            if await _has_descendant(db, new_parent_id, fid):
                raise HTTPException(400, "자손 폴더로는 이동할 수 없습니다")
            folder.parent_id = parent.id
        else:
            folder.parent_id = None

    if "sort_order" in patch and patch["sort_order"] is not None:
        folder.sort_order = int(patch["sort_order"])

    await db.flush()
    await log_action(
        db, user, "drive.folder.update",
        target=f"folder:{fid}",
        detail=f"name={folder.name} parent={folder.parent_id}",
    )
    return _folder_to_dict(folder)


# ─────────────────────────────────────────────────────────────────────────────
# 폴더 삭제 (자료는 folder_id=NULL로 떨어짐 — cascade ondelete=SET NULL)
# ─────────────────────────────────────────────────────────────────────────────


@router.delete("/folders/{fid}")
async def delete_folder(
    fid: int,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    folder = await _assert_my_folder(db, user, fid)
    await _assert_writable(folder)
    # 자식 폴더가 있으면 거부 (사용자가 정리하도록)
    child = (await db.execute(
        select(Folder).where(
            Folder.parent_id == fid,
            Folder.deleted_at.is_(None),
        ).limit(1)
    )).scalar_one_or_none()
    if child:
        raise HTTPException(400, "하위 폴더가 있는 폴더는 삭제할 수 없습니다. 먼저 정리하세요.")

    await db.delete(folder)
    await db.flush()
    await log_action(
        db, user, "drive.folder.delete", target=f"folder:{fid}",
        detail=f"name={folder.name}",
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# 자료 폴더 이동
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/items/{type}/{item_id}/move")
async def move_item_to_folder(
    type: str,
    item_id: int,
    body: MoveItemReq,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """자료의 folder_id를 변경.

    body.folder_id=None이면 폴더 밖(루트)으로 이동.
    """
    if type not in ITEM_TYPES:
        raise HTTPException(404, f"알 수 없는 자료 타입: {type}")
    Model, owner_field, label = ITEM_TYPES[type]
    obj = await db.get(Model, item_id)
    if not obj:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    if getattr(obj, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 이동할 수 있습니다")

    target_folder_id: int | None = body.folder_id
    if target_folder_id is not None:
        # 대상 폴더 본인 소유 확인
        target = await _assert_my_folder(db, user, target_folder_id)
        # 잠금 폴더에는 이동 허용 (사용자가 자료 정리 가능해야 함)
        # 단 wrapper(학생 수강과목 wrapper) 같이 자식만 들어가는 폴더는 정책상 자식 있어야 하는데,
        # 사용자가 자료를 직접 wrapper에 넣는 것도 허용한다 (단순화).
        target_folder_id = target.id

    obj.folder_id = target_folder_id
    await db.flush()
    await log_action(
        db, user, "drive.item.move",
        target=f"{type}:{item_id}",
        detail=f"folder_id={target_folder_id}",
    )
    return {"ok": True, "folder_id": target_folder_id}


# ─────────────────────────────────────────────────────────────────────────────
# 일괄 동기화 (본인 / 전체)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/folders/_sync")
async def sync_my_folders(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 자동 폴더 즉시 동기화."""
    from app.services.folder_seed import sync_user_folders
    result = await sync_user_folders(db, user)
    return result


# 복사 / AI 정리 일괄 endpoint는 organize.py에 분리.
# (이 파일은 폴더 CRUD + 자료 이동 + 동기화에 집중)


@router.post("/folders/_sync-all")
async def sync_all_folders(
    semester_id: int | None = None,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """전체 active 사용자 폴더 일괄 동기화. admin 전용."""
    if user.role not in ("super_admin", "designated_admin"):
        raise HTTPException(403, "관리자만 실행할 수 있습니다")
    from app.services.folder_seed import sync_all_users
    result = await sync_all_users(db, semester_id)
    await log_action(
        db, user, "drive.folder.sync_all",
        detail=f"users={result.get('users_processed')} created={result.get('folders_created')}",
    )
    return result
