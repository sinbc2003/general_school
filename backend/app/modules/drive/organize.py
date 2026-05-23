"""드라이브 자료 복사 + AI 정리 batch + undo.

엔드포인트 (router.py의 router 객체에 등록):
  POST   /api/drive/items/{type}/{item_id}/copy   자료 복사 (Ctrl+C → Ctrl+V)
  POST   /api/drive/items/_batch-organize         AI 정리안 일괄 적용 (atomic)
  POST   /api/drive/items/_undo-organize          AI 정리 일괄 되돌리기

원칙:
  - 본인 자료만 (cross-user 차단).
  - 잠금 폴더(is_system_locked=True)는 이름변경/삭제는 X, 이동은 OK.
  - 삭제 action 없음 (AI가 자료를 삭제하지 못하게 정책 차단).
  - max_length=500 (한 요청 한도, DoS 차단).
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import Folder, User
from app.modules.drive.folders import MoveItemReq, _assert_my_folder
from app.modules.drive.router import ITEM_TYPES, router


# ─────────────────────────────────────────────────────────────────────────────
# 자료 복사 (Ctrl+C → Ctrl+V)
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/items/{type}/{item_id}/copy")
async def copy_drive_item(
    type: str,
    item_id: int,
    body: MoveItemReq | None = None,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """자료 복사 (Ctrl+C → Ctrl+V).

    docs/sheets/decks 지원. hwps/surveys는 별도 처리 필요(현재 미지원).
    body.folder_id로 대상 폴더 지정. None이면 루트.
    """
    from app.core.quota import check_quota, consume_quota
    from app.models import (
        ClassroomDocument, ClassroomSheet, ClassroomPresentation, ClassroomSlide,
    )

    if type not in ITEM_TYPES:
        raise HTTPException(404, f"알 수 없는 타입: {type}")
    if type == "surveys":
        raise HTTPException(400, "설문지 복사는 현재 지원되지 않습니다 (질문/응답 복잡)")

    Model, owner_field, label = ITEM_TYPES[type]
    src = await db.get(Model, item_id)
    if not src:
        raise HTTPException(404, f"{label}를 찾을 수 없습니다")
    # 본인 자료만 복사 (단순화 — 권한 가드 strict)
    if getattr(src, owner_field) != user.id and user.role != "super_admin":
        raise HTTPException(403, "본인의 자료만 복사할 수 있습니다")

    bytes_needed = src.storage_bytes or 0
    if bytes_needed:
        check_quota(user, bytes_needed)

    target_folder_id = body.folder_id if body else None
    if target_folder_id is not None:
        await _assert_my_folder(db, user, target_folder_id)

    new_title = f"{src.title} (복사본)"

    if type == "docs":
        assert Model is ClassroomDocument
        new_obj = ClassroomDocument(
            owner_id=user.id,
            course_id=None,
            title=new_title,
            yjs_state=src.yjs_state,
            plain_text=src.plain_text,
            access_mode="specific_users",
            storage_bytes=bytes_needed,
            folder_id=target_folder_id,
        )
    elif type == "sheets":
        assert Model is ClassroomSheet
        new_obj = ClassroomSheet(
            owner_id=user.id,
            course_id=None,
            title=new_title,
            yjs_state=src.yjs_state,
            access_mode="specific_users",
            settings=src.settings,
            storage_bytes=bytes_needed,
            folder_id=target_folder_id,
        )
    elif type == "decks":
        assert Model is ClassroomPresentation
        new_obj = ClassroomPresentation(
            owner_id=user.id,
            course_id=None,
            title=new_title,
            yjs_state=src.yjs_state,
            access_mode="specific_users",
            settings=src.settings,
            storage_bytes=bytes_needed,
            folder_id=target_folder_id,
        )
    elif type == "hwps":
        # HWP file 실 복사 — 새 자료 ID 기반 경로로 별도 파일 생성.
        from app.models import ClassroomHwp
        from app.core.files import (
            ensure_dir_async, read_bytes_async, write_bytes_async,
        )
        import secrets
        from pathlib import Path

        assert Model is ClassroomHwp
        new_obj = ClassroomHwp(
            owner_id=user.id,
            course_id=None,
            title=new_title,
            access_mode="specific_users",
            storage_bytes=bytes_needed,
            folder_id=target_folder_id,
            # file_path는 db.flush 후 채움 (id 필요)
        )
    else:
        raise HTTPException(400, f"{type} 복사 미지원")

    # quota race 회피 — flush 실패 또는 consume 실패 시 자료 자체를 롤백.
    # check_quota 통과 후 consume + 자료 add를 한 트랜잭션처럼 묶음.
    db.add(new_obj)
    copied_hwp_path: str | None = None  # rollback 용 파일 경로
    try:
        await db.flush()

        # decks는 ClassroomSlide row도 복제 (메타 + plain_text + settings)
        if type == "decks":
            src_slides = (await db.execute(
                select(ClassroomSlide).where(ClassroomSlide.presentation_id == item_id)
                .order_by(ClassroomSlide.order)
            )).scalars().all()
            for s in src_slides:
                db.add(ClassroomSlide(
                    presentation_id=new_obj.id,
                    order=s.order,
                    title=s.title,
                    plain_text=s.plain_text,
                    settings=s.settings,
                ))
            await db.flush()

        # hwps는 file 실 복사 (db row 만든 뒤 new_obj.id 기준 새 경로)
        if type == "hwps":
            from app.core.files import (
                ensure_dir_async, read_bytes_async, write_bytes_async,
            )
            import secrets
            from pathlib import Path

            if src.file_path:
                STORAGE_ROOT = Path(__file__).resolve().parents[3] / "storage"
                src_full = STORAGE_ROOT / src.file_path
                fmt = src.file_format or "hwpx"
                token = secrets.token_urlsafe(8)
                new_dir = STORAGE_ROOT / "hwps" / str(new_obj.id)
                await ensure_dir_async(new_dir)
                new_fname = f"{token}.{fmt}"
                new_full = new_dir / new_fname
                # 실 파일 복사 (read + write — symlink는 mount 환경에서 위험)
                data = await read_bytes_async(src_full)
                await write_bytes_async(new_full, data)
                copied_hwp_path = f"hwps/{new_obj.id}/{new_fname}"
                new_obj.file_path = copied_hwp_path
                new_obj.file_format = fmt
                new_obj.storage_bytes = len(data)
                bytes_needed = len(data)  # 실 파일 크기로 갱신
                await db.flush()

        if bytes_needed:
            await consume_quota(db, user, bytes_needed)
    except Exception:
        # 신규 자료 + 슬라이드 모두 rollback (cascade) → quota 영향 X.
        try:
            await db.delete(new_obj)
            await db.flush()
        except Exception:
            pass
        # HWP 실 파일 복사된 경우 — 그 파일도 cleanup
        if copied_hwp_path:
            try:
                from app.core.files import unlink_async
                from pathlib import Path
                STORAGE_ROOT = Path(__file__).resolve().parents[3] / "storage"
                await unlink_async(STORAGE_ROOT / copied_hwp_path)
            except Exception:
                pass
        raise

    await log_action(
        db, user, "drive.item.copy",
        target=f"{type}:{item_id}->{new_obj.id}",
        detail=f"folder_id={target_folder_id} title={new_title}",
    )
    return {
        "id": new_obj.id,
        "type": type,
        "title": new_obj.title,
        "folder_id": new_obj.folder_id,
    }


# ─────────────────────────────────────────────────────────────────────────────
# AI 정리안 일괄 적용 (atomic) + undo
# ─────────────────────────────────────────────────────────────────────────────


class BatchAction(BaseModel):
    action: str = Field(..., pattern="^(create_folder|rename|move|rename_and_move)$")
    # create_folder
    folder_name: str | None = None
    parent_folder_id: int | None = None
    parent_temp_id: str | None = None
    temp_id: str | None = None
    # rename / move
    item_type: str | None = None
    item_id: int | None = None
    new_title: str | None = Field(default=None, max_length=255)
    target_folder_id: int | None = None
    target_temp_id: str | None = None
    reason: str | None = None


class BatchOrganizeReq(BaseModel):
    actions: list[BatchAction] = Field(default_factory=list, max_length=500)


@router.post("/items/_batch-organize")
async def batch_organize(
    body: BatchOrganizeReq,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """AI 정리안 일괄 적용 — atomic. action 순서대로 처리, 하나라도 실패 시 전체 rollback.

    원칙:
      - 본인 자료만 (cross-user 차단)
      - 잠금 폴더 이름변경/삭제 X (이동 OK)
      - 삭제 action 없음
      - max_length=500 (한 요청에 너무 많은 action 차단)
    """
    from app.models import (
        ClassroomDocument, ClassroomHwp, ClassroomPresentation,
        ClassroomSheet, Survey,
    )
    type_models = {
        "docs": ClassroomDocument,
        "sheets": ClassroomSheet,
        "decks": ClassroomPresentation,
        "surveys": Survey,
        "hwps": ClassroomHwp,
    }
    owner_field_map = {
        "docs": "owner_id", "sheets": "owner_id", "decks": "owner_id",
        "surveys": "author_id", "hwps": "owner_id",
    }

    # temp_id → 실제 folder_id 매핑 (create_folder 결과)
    temp_to_real: dict[str, int] = {}
    created_folders: list[int] = []
    renamed: list[tuple[str, int, str]] = []  # (type, id, prev_title)
    moved: list[tuple[str, int, int | None]] = []  # (type, id, prev_folder_id)
    # undo_log — 역방향 정보. frontend가 "되돌리기" 클릭 시 backend로 보냄.
    undo_log: list[dict] = []

    async def _resolve_folder(fid: int | None, tid: str | None) -> int | None:
        if tid:
            real = temp_to_real.get(tid)
            if real is None:
                raise HTTPException(400, f"unknown temp_id: {tid}")
            return real
        if fid is not None:
            # 본인 폴더 확인
            f = await db.get(Folder, fid)
            if not f or f.owner_id != user.id:
                raise HTTPException(403, f"folder {fid} not accessible")
            return f.id
        return None

    # Atomicity 보장:
    #   - get_db dependency가 endpoint 반환 후 session.commit(), 예외 시 session.rollback().
    #   - 즉 raise만 하면 SQLAlchemy transaction이 새 폴더·rename·move 모두 자동 undo.
    #   - 명시적 db.delete cleanup은 redundant + 위험 (cascade 잘못 타면 추가 fail).
    #   - 모든 raise는 outer transaction rollback으로 이어지므로 partial 적용 0.
    try:
        for i, a in enumerate(body.actions):
            if a.action == "create_folder":
                if not a.folder_name or not a.temp_id:
                    raise HTTPException(400, f"action[{i}]: create_folder requires folder_name + temp_id")
                parent_id = await _resolve_folder(a.parent_folder_id, a.parent_temp_id)
                # 사용자 root sort_order 다음 값
                if parent_id is None:
                    max_order = (await db.execute(
                        select(Folder.sort_order).where(
                            Folder.owner_id == user.id, Folder.parent_id.is_(None),
                            Folder.deleted_at.is_(None),
                        ).order_by(Folder.sort_order.desc()).limit(1)
                    )).scalar_one_or_none() or 0
                else:
                    max_order = (await db.execute(
                        select(Folder.sort_order).where(
                            Folder.parent_id == parent_id, Folder.deleted_at.is_(None),
                        ).order_by(Folder.sort_order.desc()).limit(1)
                    )).scalar_one_or_none() or 0
                f = Folder(
                    owner_id=user.id,
                    parent_id=parent_id,
                    name=a.folder_name.strip()[:255],
                    sort_order=int(max_order) + 1,
                    is_system_locked=False,
                )
                db.add(f)
                await db.flush()
                temp_to_real[a.temp_id] = f.id
                created_folders.append(f.id)
                # undo: 새로 만든 폴더 삭제
                undo_log.append({"undo": "delete_folder", "folder_id": f.id})
                continue

            # rename / move / rename_and_move
            if not a.item_type or a.item_id is None:
                raise HTTPException(400, f"action[{i}]: item_type/item_id required")
            if a.item_type not in type_models:
                raise HTTPException(400, f"action[{i}]: unknown item_type {a.item_type}")
            Model = type_models[a.item_type]
            obj = await db.get(Model, a.item_id)
            if not obj:
                raise HTTPException(404, f"action[{i}]: {a.item_type}:{a.item_id} not found")
            owner_field = owner_field_map[a.item_type]
            if getattr(obj, owner_field) != user.id and user.role != "super_admin":
                raise HTTPException(403, f"action[{i}]: {a.item_type}:{a.item_id} not owned")

            if a.action in ("rename", "rename_and_move"):
                if not a.new_title:
                    raise HTTPException(400, f"action[{i}]: new_title required")
                renamed.append((a.item_type, a.item_id, obj.title))
                undo_log.append({
                    "undo": "rename", "item_type": a.item_type, "item_id": a.item_id,
                    "prev_title": obj.title,
                })
                obj.title = a.new_title.strip()[:255]
            if a.action in ("move", "rename_and_move"):
                target = await _resolve_folder(a.target_folder_id, a.target_temp_id)
                moved.append((a.item_type, a.item_id, obj.folder_id))
                undo_log.append({
                    "undo": "move", "item_type": a.item_type, "item_id": a.item_id,
                    "prev_folder_id": obj.folder_id,
                })
                obj.folder_id = target
            await db.flush()

        await db.flush()
    except HTTPException:
        # transaction rollback이 자동 cleanup → 그대로 re-raise.
        raise
    except Exception as e:
        # IntegrityError, connection drop, 코드 버그 등 — 동일하게 transaction rollback.
        # 사용자에게는 500 + 짧은 type 정보만 노출 (raw exception은 보안 위험).
        raise HTTPException(
            500,
            f"드라이브 정리 일괄 적용 실패 — 모든 변경이 rollback됨 ({type(e).__name__})",
        )

    await log_action(
        db, user, "drive.batch_organize",
        detail=f"actions={len(body.actions)} folders={len(created_folders)} renames={len(renamed)} moves={len(moved)}",
    )
    return {
        "ok": True,
        "created_folders": len(created_folders),
        "renamed": len(renamed),
        "moved": len(moved),
        "temp_to_real": temp_to_real,
        # 역방향 정보 — frontend가 "되돌리기" 클릭 시 _undo-organize endpoint로 전달.
        # 역순 실행: 자료를 먼저 원상복구 후 빈 폴더 삭제.
        "undo_log": undo_log,
    }


class UndoOrganizeReq(BaseModel):
    undo_log: list[dict] = Field(default_factory=list, max_length=1000)


@router.post("/items/_undo-organize")
async def undo_organize(
    body: UndoOrganizeReq,
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """AI 정리 일괄 되돌리기.

    Frontend가 batch_organize의 응답 undo_log를 그대로 보냄.
    역순으로 실행: rename/move 복원 후 새로 만든 폴더 삭제.
    본인 자료만 (cross-user 차단).
    """
    from app.models import (
        ClassroomDocument, ClassroomHwp, ClassroomPresentation,
        ClassroomSheet, Survey,
    )
    type_models = {
        "docs": ClassroomDocument, "sheets": ClassroomSheet,
        "decks": ClassroomPresentation, "surveys": Survey, "hwps": ClassroomHwp,
    }
    owner_field_map = {
        "docs": "owner_id", "sheets": "owner_id", "decks": "owner_id",
        "surveys": "author_id", "hwps": "owner_id",
    }

    restored = {"renamed": 0, "moved": 0, "folders_deleted": 0, "errors": []}

    # 역순 — rename/move 먼저 (자료를 폴더 밖으로 빼야 빈 폴더 삭제 가능)
    for entry in reversed(body.undo_log):
        try:
            kind = entry.get("undo")
            if kind == "rename":
                t = entry.get("item_type")
                if t not in type_models:
                    continue
                Model = type_models[t]
                obj = await db.get(Model, entry.get("item_id"))
                if not obj:
                    continue
                owner_field = owner_field_map[t]
                if getattr(obj, owner_field) != user.id and user.role != "super_admin":
                    continue
                obj.title = (entry.get("prev_title") or obj.title)[:255]
                restored["renamed"] += 1
            elif kind == "move":
                t = entry.get("item_type")
                if t not in type_models:
                    continue
                Model = type_models[t]
                obj = await db.get(Model, entry.get("item_id"))
                if not obj:
                    continue
                owner_field = owner_field_map[t]
                if getattr(obj, owner_field) != user.id and user.role != "super_admin":
                    continue
                obj.folder_id = entry.get("prev_folder_id")
                restored["moved"] += 1
            elif kind == "delete_folder":
                fid = entry.get("folder_id")
                f = await db.get(Folder, fid) if fid else None
                if not f:
                    continue
                if f.owner_id != user.id and user.role != "super_admin":
                    continue
                # 자식 폴더 / 자료가 있으면 skip (사용자가 그새 채워뒀을 수 있음)
                child = (await db.execute(
                    select(Folder).where(
                        Folder.parent_id == fid, Folder.deleted_at.is_(None),
                    ).limit(1)
                )).scalar_one_or_none()
                if child:
                    restored["errors"].append(f"folder {fid}: 하위 폴더 있어 삭제 skip")
                    continue
                # 자료 있는지 확인 (5종)
                has_content = False
                for t, Model in type_models.items():
                    cnt = (await db.execute(
                        select(Model).where(Model.folder_id == fid).limit(1)
                    )).scalar_one_or_none()
                    if cnt:
                        has_content = True
                        break
                if has_content:
                    restored["errors"].append(f"folder {fid}: 자료 들어있어 삭제 skip")
                    continue
                await db.delete(f)
                restored["folders_deleted"] += 1
        except Exception as e:
            restored["errors"].append(str(e)[:200])

    await db.flush()
    await log_action(
        db, user, "drive.batch_organize.undo",
        detail=(
            f"renamed={restored['renamed']} moved={restored['moved']} "
            f"folders_deleted={restored['folders_deleted']} "
            f"errors={len(restored['errors'])}"
        ),
    )
    return restored
