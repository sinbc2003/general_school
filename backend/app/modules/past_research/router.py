"""과거 학생 연구 보고서 아카이브 라우터.

- 관리자: ZIP 일괄 업로드 (파일명 자동 파싱) + 삭제
- 모든 인증 사용자: 검색·조회·다운로드 (다운로드는 files 가드 거침)
"""

import io
import os
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import String as SaString
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import POLICY_PAST_RESEARCH_ZIP, validate_upload
from app.models.past_research import PastResearch
from app.models.user import User
from app.modules.past_research.parser import parse_filename

router = APIRouter(prefix="/api/past-research", tags=["past-research"])

UPLOAD_DIR = os.path.join("storage", "past_research")
MAX_PDFS_PER_ZIP = 2000
MAX_PDF_SIZE = 50 * 1024 * 1024  # 50MB per PDF


def _to_item(p: PastResearch) -> dict:
    return {
        "id": p.id,
        "year": p.year,
        "grade": p.grade,
        "semester": p.semester,
        "report_type": p.report_type,
        "fields": list(p.fields or []),
        "title": p.title,
        "is_excellent": p.is_excellent,
        "original_filename": p.original_filename,
        "file_size": p.file_size,
        "file_url": "/" + p.stored_path.replace("\\", "/"),
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("")
async def list_past_research(
    keyword: str | None = None,
    year: int | None = None,
    semester: int | None = None,
    grade: int | None = None,
    report_type: str | None = None,
    field: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(PastResearch)
    cq = select(func.count(PastResearch.id))

    conds = []
    if keyword:
        kw = f"%{keyword.strip()}%"
        conds.append(or_(
            PastResearch.title.ilike(kw),
            PastResearch.original_filename.ilike(kw),
        ))
    if year is not None:
        conds.append(PastResearch.year == year)
    if semester is not None:
        conds.append(PastResearch.semester == semester)
    if grade is not None:
        conds.append(PastResearch.grade == grade)
    if report_type:
        conds.append(PastResearch.report_type == report_type)
    if field:
        # 단순 텍스트 매칭 (분야명이 짧고 unique). PG/SQLite 모두 호환.
        conds.append(func.cast(PastResearch.fields, SaString).ilike(f"%{field}%"))

    if conds:
        q = q.where(and_(*conds))
        cq = cq.where(and_(*conds))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(
            PastResearch.year.desc(),
            PastResearch.semester.desc().nulls_last(),
            PastResearch.title,
        )
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [_to_item(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/_facets")
async def get_facets(
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    """필터 옵션용 unique 값 모음."""
    years = (await db.execute(
        select(PastResearch.year).distinct().order_by(PastResearch.year.desc())
    )).scalars().all()
    types = (await db.execute(
        select(PastResearch.report_type).distinct().where(PastResearch.report_type.is_not(None))
    )).scalars().all()
    grades = (await db.execute(
        select(PastResearch.grade).distinct().where(PastResearch.grade.is_not(None)).order_by(PastResearch.grade)
    )).scalars().all()

    field_rows = (await db.execute(select(PastResearch.fields))).scalars().all()
    all_fields: set[str] = set()
    for fs in field_rows:
        for f in (fs or []):
            if isinstance(f, str) and f.strip():
                all_fields.add(f.strip())

    return {
        "years": [int(y) for y in years if y is not None],
        "report_types": sorted(t for t in types if t),
        "grades": [int(g) for g in grades if g is not None],
        "fields": sorted(all_fields),
    }


@router.post("/_bulk-upload")
async def bulk_upload(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("past_research.upload")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """ZIP 일괄 업로드. 파일명 자동 파싱.

    결과:
        success: 등록된 PDF 수
        skipped: 이미 등록되어 있어 건너뛴 항목 [{filename, reason}]
        failed:  파싱/검증 실패 [{filename, reason}]
    """
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
        # 일부 ZIP은 macOS 메타 폴더 포함 (__MACOSX) — skip
        if "__MACOSX" in member or os.path.basename(member).startswith("._"):
            continue

        # 파일명만 (디렉터리 경로 무시 — path traversal 방어 포함)
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

        # 중복 검사 (year + title 동일하면 skip)
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
        # 파일 삭제 실패해도 DB row는 삭제 (orphan 방지)
        print(f"[past_research] 파일 삭제 실패: {e}")

    await db.delete(row)
    await db.flush()
    await log_action(db, user, "past_research.delete", f"id={rid}", request=request)
    return {"ok": True}
