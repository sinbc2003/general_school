"""내 드라이브 백업 — 학교 이동 시 사용자 자료 전체 export.

옵션:
  1. ZIP 다운로드: 자료 5종 + 폴더 트리 + manifest.json
     - docs/sheets/decks/surveys: JSON(메타 + yjs_state base64 + plain_text)
     - hwps: 원본 file
     - manifest.json: 자료 list + 폴더 트리 + 사용자 정보
  2. Google Drive 일괄: docs/sheets만 우선 (google_integration/export.py 활용)

ZIP 구조:
  my-drive-backup-{user}-{yyyymmdd}.zip
    manifest.json
    folders/
      (folder tree in JSON)
    docs/
      {id}.json
    sheets/
      {id}.json
    decks/
      {id}.json
      slides_{id}.json  (ClassroomSlide rows 별도)
    surveys/
      {id}.json
      responses_{id}.json
    hwps/
      {id}/{원본 파일명}
      {id}.json  (메타)

자료 본문은 사람-읽기 변환(HTML/XLSX) 미포함 — 본 시스템 재import용 + plain_text fallback.
"""

from __future__ import annotations

import base64
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    ClassroomDocument, ClassroomHwp, ClassroomPresentation, ClassroomSheet,
    ClassroomSlide, Folder, Survey, SurveyAnswer, SurveyQuestion, SurveyResponse, User,
)
from app.modules.drive.router import router

STORAGE_ROOT = Path(__file__).resolve().parents[3] / "storage"


def _serialize_folder(f: Folder) -> dict[str, Any]:
    return {
        "id": f.id,
        "parent_id": f.parent_id,
        "name": f.name,
        "auto_kind": f.auto_kind,
        "semester_id": f.semester_id,
        "source_kind": f.source_kind,
        "source_id": f.source_id,
        "sort_order": f.sort_order,
        "is_system_locked": f.is_system_locked,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


def _serialize_doc(d: ClassroomDocument) -> dict[str, Any]:
    return {
        "id": d.id,
        "title": d.title,
        "course_id": d.course_id,
        "folder_id": d.folder_id,
        "access_mode": d.access_mode,
        "plain_text": d.plain_text,
        "yjs_state_base64": base64.b64encode(d.yjs_state).decode("ascii") if d.yjs_state else None,
        "storage_bytes": d.storage_bytes,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def _serialize_sheet(s: ClassroomSheet) -> dict[str, Any]:
    return {
        "id": s.id,
        "title": s.title,
        "course_id": s.course_id,
        "folder_id": s.folder_id,
        "access_mode": s.access_mode,
        "settings": s.settings,
        "yjs_state_base64": base64.b64encode(s.yjs_state).decode("ascii") if s.yjs_state else None,
        "storage_bytes": s.storage_bytes,
        "source_survey_id": s.source_survey_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _serialize_deck(p: ClassroomPresentation) -> dict[str, Any]:
    return {
        "id": p.id,
        "title": p.title,
        "course_id": p.course_id,
        "folder_id": p.folder_id,
        "access_mode": p.access_mode,
        "settings": p.settings,
        "yjs_state_base64": base64.b64encode(p.yjs_state).decode("ascii") if p.yjs_state else None,
        "storage_bytes": p.storage_bytes,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _serialize_slide(sl: ClassroomSlide) -> dict[str, Any]:
    return {
        "id": sl.id,
        "presentation_id": sl.presentation_id,
        "order": sl.order,
        "title": sl.title,
        "plain_text": sl.plain_text,
        "settings": sl.settings,
    }


def _serialize_survey(sv: Survey, questions: list[SurveyQuestion]) -> dict[str, Any]:
    return {
        "id": sv.id,
        "title": sv.title,
        "description": sv.description,
        "course_id": sv.course_id,
        "folder_id": sv.folder_id,
        "status": sv.status,
        "is_anonymous": sv.is_anonymous,
        "access_mode": sv.access_mode,
        "questions": [
            {
                "id": q.id, "order": q.order, "type": q.type,
                "question_text": q.question_text, "is_required": q.is_required,
                "options": q.options, "settings": q.settings,
            }
            for q in questions
        ],
        "created_at": sv.created_at.isoformat() if sv.created_at else None,
    }


def _serialize_hwp(h: ClassroomHwp) -> dict[str, Any]:
    return {
        "id": h.id,
        "title": h.title,
        "course_id": h.course_id,
        "folder_id": h.folder_id,
        "access_mode": h.access_mode,
        "file_path": h.file_path,
        "file_format": h.file_format,
        "storage_bytes": h.storage_bytes,
        "created_at": h.created_at.isoformat() if h.created_at else None,
    }


def _safe_name(s: str | None) -> str:
    """ZIP 안 파일명용. 윈도우 호환 (특수 문자 _)."""
    base = (s or "untitled").strip()
    for ch in '<>:"/\\|?*\n\r\t':
        base = base.replace(ch, "_")
    return base[:80] or "untitled"


async def _build_zip(db: AsyncSession, user: User) -> bytes:
    """본인 자료 모두 수집 → ZIP bytes 반환."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # 폴더 트리
        folders = (await db.execute(
            select(Folder).where(
                Folder.owner_id == user.id,
                Folder.deleted_at.is_(None),
            ).order_by(Folder.sort_order)
        )).scalars().all()
        z.writestr(
            "folders.json",
            json.dumps([_serialize_folder(f) for f in folders], ensure_ascii=False, indent=2),
        )

        # docs
        docs = (await db.execute(
            select(ClassroomDocument).where(
                ClassroomDocument.owner_id == user.id,
                ClassroomDocument.deleted_at.is_(None),
            )
        )).scalars().all()
        for d in docs:
            data = _serialize_doc(d)
            z.writestr(
                f"docs/{d.id}_{_safe_name(d.title)}.json",
                json.dumps(data, ensure_ascii=False, indent=2),
            )

        # sheets
        sheets = (await db.execute(
            select(ClassroomSheet).where(
                ClassroomSheet.owner_id == user.id,
                ClassroomSheet.deleted_at.is_(None),
            )
        )).scalars().all()
        for s in sheets:
            data = _serialize_sheet(s)
            z.writestr(
                f"sheets/{s.id}_{_safe_name(s.title)}.json",
                json.dumps(data, ensure_ascii=False, indent=2),
            )

        # decks + slides
        decks = (await db.execute(
            select(ClassroomPresentation).where(
                ClassroomPresentation.owner_id == user.id,
                ClassroomPresentation.deleted_at.is_(None),
            )
        )).scalars().all()
        for p in decks:
            data = _serialize_deck(p)
            slides = (await db.execute(
                select(ClassroomSlide).where(
                    ClassroomSlide.presentation_id == p.id,
                ).order_by(ClassroomSlide.order)
            )).scalars().all()
            data["slides"] = [_serialize_slide(sl) for sl in slides]
            z.writestr(
                f"decks/{p.id}_{_safe_name(p.title)}.json",
                json.dumps(data, ensure_ascii=False, indent=2),
            )

        # surveys + questions (응답은 본인 자료라 익명/타인 응답 제외 — author만)
        surveys = (await db.execute(
            select(Survey).where(
                Survey.author_id == user.id,
                Survey.deleted_at.is_(None),
            )
        )).scalars().all()
        for sv in surveys:
            questions = (await db.execute(
                select(SurveyQuestion).where(
                    SurveyQuestion.survey_id == sv.id,
                ).order_by(SurveyQuestion.order)
            )).scalars().all()
            data = _serialize_survey(sv, questions)
            z.writestr(
                f"surveys/{sv.id}_{_safe_name(sv.title)}.json",
                json.dumps(data, ensure_ascii=False, indent=2),
            )

        # hwps — file 그대로 + 메타
        hwps = (await db.execute(
            select(ClassroomHwp).where(
                ClassroomHwp.owner_id == user.id,
                ClassroomHwp.deleted_at.is_(None),
            )
        )).scalars().all()
        for h in hwps:
            z.writestr(
                f"hwps/{h.id}_{_safe_name(h.title)}.json",
                json.dumps(_serialize_hwp(h), ensure_ascii=False, indent=2),
            )
            if h.file_path:
                full = STORAGE_ROOT / h.file_path
                if full.exists():
                    fmt = h.file_format or "hwpx"
                    z.write(full, f"hwps/{h.id}_{_safe_name(h.title)}.{fmt}")

        # manifest
        manifest = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "system": "general_school",
            "version": "1.0",
            "user": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "role": user.role,
            },
            "counts": {
                "folders": len(folders),
                "docs": len(docs),
                "sheets": len(sheets),
                "decks": len(decks),
                "surveys": len(surveys),
                "hwps": len(hwps),
            },
            "note": (
                "본 ZIP은 일반학교 플랫폼(general_school) 백업입니다. "
                "자료 본문은 JSON + Yjs binary(base64). "
                "사람-읽기 형식이 필요하면 plain_text 필드를 참고하세요. "
                "같은 시스템 다른 학교 서버에 import 가능 (관리자 백업 복원 별도)."
            ),
        }
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    return buf.getvalue()


@router.post("/backup/download")
async def download_my_drive_backup(
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 드라이브 전체를 ZIP으로 다운로드.

    학교 이동 시 사용. 자료가 많으면 응답 지연 가능 (background queue는 향후).
    """
    blob = await _build_zip(db, user)
    fname = f"drive-backup-{user.email}-{datetime.now().strftime('%Y%m%d')}.zip"

    await log_action(
        db, user, "drive.backup.download",
        target=f"user:{user.id}",
        detail=f"size={len(blob)}",
    )

    return StreamingResponse(
        io.BytesIO(blob),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


