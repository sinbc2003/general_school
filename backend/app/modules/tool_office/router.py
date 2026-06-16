"""업무 도구 — PDF→HWPX 변환, PDF 번역 (비동기 잡 + 폴링).

흐름: POST(파일 업로드) → ToolJob 생성 + 입력 저장 + 백그라운드 task → {job_id}
      GET /jobs/{id} 폴링 → 완료 시 output_file_url 다운로드(downloadSecure).

PDF→HWPX : Mathpix OCR + 벤더 pdf2hwpx 엔진 (관리자가 Mathpix 키 설정 필요).
PDF 번역  : PyMuPDF 텍스트 추출 + 플랫폼 LLM(챗봇 인프라) 번역.
"""

import asyncio
import logging
import shutil

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.files import DEFAULT_STORAGE_ROOT, ensure_dir_async, write_bytes_async
from app.core.permissions import is_admin, require_permission
from app.core.upload import POLICY_PDF, validate_upload
from app.models.tool_job import ToolJob, ToolJobStatus
from app.models.user import User

from .schemas import MathpixConfigBody
from ...services.tool_office import config as office_config
from ...services.tool_office.llm import llm_available
from ...services.tool_office.runner import run_pdf2hwpx_job, run_translate_job
from ...services.tool_office.translate import LANG_NAMES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tools/office", tags=["tool-office"])

_VALID_MODES = {"hybrid", "image", "pdf"}
_VALID_DOC_TYPES = {"exam", "general"}


def _job_dict(job: ToolJob) -> dict:
    return {
        "id": job.id,
        "tool": job.tool,
        "status": job.status.value if job.status else None,
        "progress": job.progress,
        "stage": job.stage,
        "title": job.title,
        "input_filename": job.input_filename,
        "error": job.error,
        "output_ready": bool(job.output_file_url) and job.status == ToolJobStatus.COMPLETED,
        "output_file_url": job.output_file_url,
        "result_meta": job.result_meta or {},
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


# 백그라운드 task 강참조 보관 — create_task 반환값을 버리면 GC로 취소될 수 있음
_BG_TASKS: set[asyncio.Task] = set()


async def _save_input_pdf(job_id: int, data: bytes) -> None:
    rel = f"tool_office/{job_id}/input.pdf"
    full = DEFAULT_STORAGE_ROOT / rel
    await ensure_dir_async(full.parent)
    await write_bytes_async(full, data)


async def _launch(db: AsyncSession, job: ToolJob, data: bytes, runner) -> None:
    """입력 PDF 저장 + 백그라운드 잡 실행.

    저장 실패(스토리지 다운/NFS 타임아웃) 시 잡을 즉시 FAILED로 마킹 — PENDING 좀비 방지.
    create_task 결과는 _BG_TASKS에 보관해 GC 취소를 막는다.
    """
    try:
        await _save_input_pdf(job.id, data)
    except Exception as exc:  # noqa: BLE001
        job.status = ToolJobStatus.FAILED
        job.error = f"입력 파일 저장 실패: {exc}"[:2000]
        await db.commit()
        raise HTTPException(503, "입력 파일을 저장하지 못했습니다 (스토리지 상태를 확인하세요).")
    t = asyncio.create_task(runner(job.id))
    _BG_TASKS.add(t)
    t.add_done_callback(_BG_TASKS.discard)


async def _owned_job(db: AsyncSession, user: User, job_id: int) -> ToolJob:
    job = await db.get(ToolJob, job_id)
    if not job or (job.owner_id != user.id and not is_admin(user)):
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    return job


# ── 상태/설정 ──────────────────────────────────────────────────

@router.get("/status")
async def office_status(
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    """도구 사용 전 readiness 안내 (UI 경고용)."""
    return {
        "mathpix_configured": await office_config.is_mathpix_configured(db),
        "mathpix_enabled": await office_config.is_mathpix_enabled(db),
        "llm_configured": await llm_available(db),
        "languages": LANG_NAMES,
    }


@router.get("/mathpix-config")
async def get_mathpix_config(
    user: User = Depends(require_permission("tools.office.configure")),
    db: AsyncSession = Depends(get_db),
):
    from app.core.encryption import mask_secret

    app_id = await office_config.get_config(db, "mathpix.app_id")
    app_key = await office_config.get_config(db, "mathpix.app_key")
    return {
        "configured": bool(app_id and app_key),
        "enabled": await office_config.is_mathpix_enabled(db),
        "app_id": app_id or "",
        "app_key_preview": mask_secret(app_key or ""),
    }


@router.put("/mathpix-config")
async def update_mathpix_config(
    body: MathpixConfigBody,
    request: Request,
    user: User = Depends(require_permission("tools.office.configure")),
    db: AsyncSession = Depends(get_db),
):
    if body.app_id.strip():
        await office_config.set_config(db, "mathpix.app_id", body.app_id.strip(), encrypt_it=False)
    if body.app_key.strip():  # 빈 값이면 기존 키 유지
        await office_config.set_config(db, "mathpix.app_key", body.app_key.strip(), encrypt_it=True)
    await office_config.set_config(
        db, "mathpix.enabled", "true" if body.enabled else "false", encrypt_it=False
    )
    await log_action(db, user, "mathpix_config_update", request=request)
    await db.commit()
    return {"ok": True}


# ── 잡 생성 ────────────────────────────────────────────────────

@router.post("/pdf2hwpx")
async def create_pdf2hwpx(
    file: UploadFile = File(...),
    mode: str = Form("hybrid"),
    doc_type: str = Form("exam"),
    columns: int = Form(1),
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    """PDF → HWPX 변환 잡 시작."""
    if not await office_config.is_mathpix_configured(db):
        raise HTTPException(
            400,
            "Mathpix API 키가 설정되지 않았습니다. "
            "관리자에게 시스템 → PDF 도구(Mathpix) 설정을 요청하세요.",
        )
    if not await office_config.is_mathpix_enabled(db):
        raise HTTPException(400, "PDF→HWPX 변환이 비활성화되어 있습니다.")
    if mode not in _VALID_MODES:
        raise HTTPException(400, f"잘못된 mode: {mode}")
    if doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(400, f"잘못된 doc_type: {doc_type}")
    columns = 2 if int(columns) == 2 else 1

    data = await validate_upload(file, POLICY_PDF)

    job = ToolJob(
        tool="pdf2hwpx",
        owner_id=user.id,
        title=(file.filename or "변환").rsplit(".", 1)[0],
        input_filename=file.filename,
        options={"mode": mode, "doc_type": doc_type, "columns": columns},
        status=ToolJobStatus.PENDING,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    await _launch(db, job, data, run_pdf2hwpx_job)
    return _job_dict(job)


@router.post("/translate")
async def create_translate(
    file: UploadFile = File(...),
    target_lang: str = Form("ko"),
    source_lang: str = Form(""),
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    """PDF 번역 잡 시작 (플랫폼 LLM 사용)."""
    if not await llm_available(db):
        raise HTTPException(
            400,
            "사용 가능한 LLM이 없습니다. "
            "관리자가 /system/llm/providers 에서 API 키를 등록·활성화해야 합니다.",
        )

    data = await validate_upload(file, POLICY_PDF)

    job = ToolJob(
        tool="pdf_translate",
        owner_id=user.id,
        title=(file.filename or "번역").rsplit(".", 1)[0],
        input_filename=file.filename,
        options={"target_lang": target_lang, "source_lang": source_lang or None},
        status=ToolJobStatus.PENDING,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    await _launch(db, job, data, run_translate_job)
    return _job_dict(job)


# ── 잡 조회/삭제 ────────────────────────────────────────────────

@router.get("/jobs")
async def list_jobs(
    tool: str | None = None,
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    q = select(ToolJob).where(ToolJob.owner_id == user.id)
    if tool:
        q = q.where(ToolJob.tool == tool)
    q = q.order_by(ToolJob.id.desc()).limit(30)
    rows = (await db.execute(q)).scalars().all()
    # 목록에는 인라인 텍스트(클 수 있음) 제외 — 가벼운 메타만
    out = []
    for j in rows:
        d = _job_dict(j)
        if isinstance(d.get("result_meta"), dict):
            d["result_meta"] = {k: v for k, v in d["result_meta"].items() if k != "text"}
        out.append(d)
    return {"items": out}


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: int,
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    job = await _owned_job(db, user, job_id)
    return _job_dict(job)


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: int,
    user: User = Depends(require_permission("tools.office.use")),
    db: AsyncSession = Depends(get_db),
):
    job = await _owned_job(db, user, job_id)
    await db.delete(job)
    await db.commit()
    # 입력/결과 파일 정리 (best-effort)
    job_dir = DEFAULT_STORAGE_ROOT / "tool_office" / str(job_id)
    try:
        await asyncio.to_thread(shutil.rmtree, job_dir, True)
    except Exception:  # noqa: BLE001
        logger.warning("tool_office 파일 정리 실패: %s", job_dir)
    return {"ok": True}
