"""관리자 ZIP 일괄 업로드 + 삭제."""

import io
import os
import uuid
import zipfile
from pathlib import Path

from fastapi import Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import POLICY_PAST_RESEARCH_ZIP, validate_upload
from app.models.past_research import PastResearch
from app.models.user import User
from app.modules.past_research._helpers import MAX_PDF_SIZE, MAX_PDFS_PER_ZIP, UPLOAD_DIR
from app.modules.past_research.parser import parse_filename
from app.modules.past_research.router import router


@router.post("/_bulk-upload")
async def bulk_upload(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("past_research.upload")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """ZIP 일괄 업로드. 파일명 자동 파싱."""
    data = await validate_upload(file, POLICY_PAST_RESEARCH_ZIP)

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "잘못된 ZIP 파일")

    members = [n for n in zf.namelist() if not n.endswith("/")]
    if len(members) > MAX_PDFS_PER_ZIP:
        raise HTTPException(400, f"ZIP 내부 파일이 너무 많습니다 ({len(members)} > {MAX_PDFS_PER_ZIP})")

    await ensure_dir_async(Path(UPLOAD_DIR))

    success = 0
    skipped: list[dict] = []
    failed: list[dict] = []

    for member in members:
        if "__MACOSX" in member or os.path.basename(member).startswith("._"):
            continue

        try:
            raw_name = member.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            raw_name = member
        display_name = os.path.basename(raw_name)

        if not display_name.lower().endswith(".pdf"):
            failed.append({"filename": display_name or member, "reason": "PDF 아님"})
            continue

        parsed = parse_filename(display_name)
        if not parsed:
            failed.append({
                "filename": display_name,
                "reason": "파일명 패턴 불일치 — '{YYYY} {N}학년 {S}학기 ... 보고서(분야)_제목.pdf' 형식 필요",
            })
            continue

        existing = (await db.execute(
            select(PastResearch).where(
                PastResearch.year == parsed["year"],
                PastResearch.title == parsed["title"],
            )
        )).scalar_one_or_none()
        if existing:
            skipped.append({"filename": display_name, "reason": "이미 등록됨"})
            continue

        try:
            content = zf.read(member)
        except Exception as e:
            failed.append({"filename": display_name, "reason": f"읽기 실패: {e}"})
            continue

        if len(content) == 0:
            failed.append({"filename": display_name, "reason": "빈 파일"})
            continue
        if len(content) > MAX_PDF_SIZE:
            failed.append({
                "filename": display_name,
                "reason": f"PDF 크기 초과 ({len(content)} > {MAX_PDF_SIZE})",
            })
            continue
        if not content.startswith(b"%PDF-"):
            failed.append({"filename": display_name, "reason": "PDF 헤더 누락 (위조 파일?)"})
            continue

        stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.pdf")
        try:
            await write_bytes_async(Path(stored_path), content)
        except Exception as e:
            failed.append({"filename": display_name, "reason": f"저장 실패: {e}"})
            continue

        row = PastResearch(
            year=parsed["year"],
            grade=parsed["grade"],
            semester=parsed["semester"],
            report_type=parsed["report_type"],
            fields=parsed["fields"],
            title=parsed["title"],
            is_excellent=parsed["is_excellent"],
            original_filename=display_name,
            stored_path=stored_path,
            file_size=len(content),
            uploaded_by_id=user.id,
        )
        db.add(row)
        success += 1

    await db.flush()
    await log_action(
        db, user, "past_research.bulk_upload",
        f"success={success} skipped={len(skipped)} failed={len(failed)}",
        request=request,
    )

    return {"success": success, "skipped": skipped, "failed": failed}


@router.delete("/{rid}")
async def delete_past_research(
    rid: int,
    user: User = Depends(require_permission("past_research.delete")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    row = (await db.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)

    try:
        p = Path(row.stored_path)
        if p.exists():
            p.unlink()
    except Exception as e:
        print(f"[past_research] 파일 삭제 실패: {e}")

    await db.delete(row)
    await db.flush()
    await log_action(db, user, "past_research.delete", f"id={rid}", request=request)
    return {"ok": True}
