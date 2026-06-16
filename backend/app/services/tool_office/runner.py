"""업무 도구 백그라운드 잡 실행기.

요청 핸들러에서 asyncio.create_task(run_*_job(job_id)) 로 띄운다.
각 잡은 자체 DB 세션을 열고(요청 세션은 응답과 함께 닫힘), 단계마다 commit 해
폴링 엔드포인트가 실시간 진행률을 본다. 동기 엔진은 asyncio.to_thread 로 감싼다.

워커당 동시 잡 수를 세마포어로 제한 (gunicorn -w 6 환경에서 폭주 방지).
"""

import asyncio
import logging
from datetime import datetime, timezone

from app.core.database import async_session_factory
from app.core.files import (
    DEFAULT_STORAGE_ROOT,
    ensure_dir_async,
    read_bytes_async,
    write_bytes_async,
)
from app.models.tool_job import ToolJob, ToolJobStatus

from .config import get_mathpix_keys
from .engine_pdf2hwpx import convert_pdf_to_hwpx
from .llm import LLMUnavailable, llm_complete
from .translate import build_system_prompt, chunk_text, extract_pages, lang_label

logger = logging.getLogger(__name__)

# 워커당 동시 잡 제한 (PDF OCR/번역은 무거움)
_JOB_SEM = asyncio.Semaphore(3)

# result_meta에 인라인 저장하는 번역문 최대 길이 (초과 시 파일로만 제공)
_INLINE_TEXT_CAP = 100_000


async def _set(db, job: ToolJob, **fields) -> None:
    for k, v in fields.items():
        setattr(job, k, v)
    await db.commit()


async def _input_pdf_bytes(job: ToolJob) -> bytes:
    """storage/tool_office/{id}/input.pdf 읽기."""
    rel = f"tool_office/{job.id}/input.pdf"
    return await read_bytes_async(DEFAULT_STORAGE_ROOT / rel)


async def _fail(job_id: int, exc: Exception) -> None:
    logger.exception("tool job %s failed", job_id)
    async with async_session_factory() as db2:
        job = await db2.get(ToolJob, job_id)
        if not job:
            return
        job.status = ToolJobStatus.FAILED
        job.error = str(exc)[:2000]
        job.finished_at = datetime.now(timezone.utc)
        await db2.commit()


async def run_pdf2hwpx_job(job_id: int) -> None:
    try:
        async with _JOB_SEM, async_session_factory() as db:
            job = await db.get(ToolJob, job_id)
            if not job:
                return
            opts = job.options or {}
            await _set(
                db, job,
                status=ToolJobStatus.RUNNING,
                started_at=datetime.now(timezone.utc),
                stage="입력 파일 읽는 중", progress=5,
            )
            pdf_bytes = await _input_pdf_bytes(job)

            app_id, app_key = await get_mathpix_keys(db)
            if not (app_id and app_key):
                raise LLMUnavailable(
                    "Mathpix API 키가 설정되지 않았습니다. "
                    "관리자가 시스템 → PDF 도구(Mathpix)에서 등록해야 합니다."
                )

            await _set(db, job, stage="OCR·수식 인식 중 (Mathpix)", progress=25)

            rel = f"tool_office/{job_id}/output.hwpx"
            full = DEFAULT_STORAGE_ROOT / rel
            await ensure_dir_async(full.parent)

            result = await asyncio.to_thread(
                convert_pdf_to_hwpx,
                pdf_bytes,
                str(full),
                app_id=app_id,
                app_key=app_key,
                mode=opts.get("mode", "hybrid"),
                doc_type=opts.get("doc_type", "exam"),
                columns=int(opts.get("columns", 1)),
            )

            await _set(
                db, job,
                status=ToolJobStatus.COMPLETED,
                stage="완료", progress=100,
                output_file_url=f"/storage/{rel}",
                result_meta={
                    "warnings": result.get("warnings", []),
                    "total_pages": result.get("total_pages", 0),
                    "success_pages": result.get("success_pages", 0),
                    "failed_pages": result.get("failed_pages", []),
                    "mmd_chars": len(result.get("mmd", "")),
                    "output_ext": "hwpx",
                },
                finished_at=datetime.now(timezone.utc),
            )
    except Exception as exc:  # noqa: BLE001
        await _fail(job_id, exc)


async def run_translate_job(job_id: int) -> None:
    try:
        async with _JOB_SEM, async_session_factory() as db:
            job = await db.get(ToolJob, job_id)
            if not job:
                return
            opts = job.options or {}
            target_lang = opts.get("target_lang", "ko")
            source_lang = opts.get("source_lang") or None

            await _set(
                db, job,
                status=ToolJobStatus.RUNNING,
                started_at=datetime.now(timezone.utc),
                stage="텍스트 추출 중", progress=5,
            )
            pdf_bytes = await _input_pdf_bytes(job)
            pages = await asyncio.to_thread(extract_pages, pdf_bytes)
            n_pages = len(pages)
            if n_pages == 0 or not any(p.strip() for p in pages):
                raise RuntimeError(
                    "PDF에서 추출할 텍스트가 없습니다 "
                    "(이미지/스캔 PDF는 현재 번역 미지원 — 텍스트 PDF만 가능)."
                )

            system = build_system_prompt(target_lang, source_lang)
            translated_pages: list[str] = []
            for i, page_text in enumerate(pages):
                await _set(
                    db, job,
                    stage=f"번역 중 {i + 1}/{n_pages} 페이지",
                    progress=10 + int(80 * i / max(n_pages, 1)),
                )
                if not page_text.strip():
                    translated_pages.append("")
                    continue
                parts: list[str] = []
                for chunk in chunk_text(page_text):
                    out = await llm_complete(db, system, chunk)
                    parts.append(out.strip())
                translated_pages.append("\n\n".join(parts))

            await _set(db, job, stage="결과 저장 중", progress=92)

            sep = "\n\n" + ("─" * 30) + "\n\n"
            full_text = sep.join(
                f"[{i + 1}쪽]\n\n{t}" for i, t in enumerate(translated_pages)
            )

            rel = f"tool_office/{job_id}/translation.txt"
            full = DEFAULT_STORAGE_ROOT / rel
            await ensure_dir_async(full.parent)
            await write_bytes_async(full, full_text.encode("utf-8"))

            meta = {
                "page_count": n_pages,
                "target_lang": target_lang,
                "target_lang_label": lang_label(target_lang),
                "char_count": len(full_text),
                "output_ext": "txt",
            }
            if len(full_text) <= _INLINE_TEXT_CAP:
                meta["text"] = full_text
            else:
                meta["text"] = full_text[:_INLINE_TEXT_CAP]
                meta["text_truncated"] = True

            await _set(
                db, job,
                status=ToolJobStatus.COMPLETED,
                stage="완료", progress=100,
                output_file_url=f"/storage/{rel}",
                result_meta=meta,
                finished_at=datetime.now(timezone.utc),
            )
    except Exception as exc:  # noqa: BLE001
        await _fail(job_id, exc)
