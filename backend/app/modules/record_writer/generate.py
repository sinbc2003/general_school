"""생기부 AI 작성 — 열 일괄 생성 / 종합 / 맞춤법.

- 전역(프로젝트) + 항목 system_prompt 결합 → LLM → generated_text.
- 종합 열(kind=summary): 다른 일반 열의 generated_text를 합쳐 입력.
- 맞춤법: LLM provider로 교정 (별도 API 키 불필요).

동시 호출(asyncio.gather + Semaphore 3) — 단가는 시작 시 1회 fetch해 메모리에서
cost 계산(_generate_one에 db를 넘기지 않아 동시 호출 시 세션 경쟁 회피).
"""

import asyncio

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.chatbot import ChatbotConfig, LLMModel, LLMProvider
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProjectStudent,
)
from app.models.user import User
from app.modules.record_writer._helpers import get_owned_project
from app.modules.record_writer.router import router
from app.modules.record_writer.schemas import (
    ComposeFinalReq, FinalTextUpdate, GenerateReq, SpellcheckReq,
)
from app.services.llm.base import LLMMessage
from app.services.llm.registry import get_adapter

_CONCURRENCY = 3
_MAX_TOKENS = 1500

_BASE_RULES = (
    "당신은 학교 생활기록부 작성 전문가입니다. 학생의 활동 자료를 바탕으로 "
    "학교생활기록부에 기재할 문장을 작성합니다.\n"
    "규칙:\n"
    "- 사실에 근거해 구체적·객관적으로 작성. 과장·추측·미사여구·홍보성 표현 금지.\n"
    "- 학생을 주어로 한 서술. 개조식 종결('~함', '~음', '~를 보임')로 마무리.\n"
    "- 자료에 없는 내용을 지어내지 말 것. 자료가 빈약하면 있는 사실만 간결히.\n"
    "- 특정 대학·기관·상호명, 부모 정보, 교외 수상 등 기재 금지 항목은 제외."
)


def build_system_prompt(
    global_prompt: str | None,
    col_prompt: str | None,
    char_min: int | None,
    char_max: int | None,
    kind: str,
) -> str:
    parts = [_BASE_RULES]
    if kind == "summary":
        parts.append(
            "[작성 형태] 아래 여러 영역의 내용을 종합해 학생의 성장·태도·역량을 "
            "관통하는 '행동특성 및 종합의견'식 단일 서술로 통합하라. 단순 나열 금지."
        )
    if char_min or char_max:
        if char_max:
            rng = f"공백 포함 {char_min or 0}자 이상 {char_max}자 이하"
        else:
            rng = f"공백 포함 {char_min}자 이상"
        parts.append(f"[분량] {rng}로 작성.")
    if global_prompt and global_prompt.strip():
        parts.append(f"[학교 공통 지침]\n{global_prompt.strip()}")
    if col_prompt and col_prompt.strip():
        parts.append(f"[이 항목 지침]\n{col_prompt.strip()}")
    parts.append("출력은 생활기록부 문장만. 머리말·설명·따옴표·코드블록 없이 본문만.")
    return "\n\n".join(parts)


async def _generate_one(
    adapter,
    model_id: str,
    system_text: str,
    user_text: str,
    in_price: float,
    out_price: float,
    *,
    max_tokens: int = _MAX_TOKENS,
    temperature: float = 0.7,
) -> dict:
    full = ""
    ti = 0
    to = 0
    err = None
    try:
        async for chunk in adapter.chat_stream(
            model=model_id,
            messages=[LLMMessage(role="user", content=user_text)],
            system=system_text,
            max_tokens=max_tokens,
            temperature=temperature,
        ):
            if chunk.error:
                err = chunk.error
            if chunk.delta:
                full += chunk.delta
            if chunk.done:
                ti = chunk.input_tokens
                to = chunk.output_tokens
    except Exception as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {e}"
    cost = (ti / 1_000_000) * in_price + (to / 1_000_000) * out_price
    return {"text": full.strip(), "tokens_in": ti, "tokens_out": to, "cost": cost, "error": err}


async def _cfg(db: AsyncSession, key: str) -> str | None:
    row = (
        await db.execute(select(ChatbotConfig).where(ChatbotConfig.key == key))
    ).scalar_one_or_none()
    return row.value if row else None


async def _resolve_model(db: AsyncSession, provider: str | None, model_id: str | None):
    if not provider:
        provider = await _cfg(db, "default_provider_teacher")
    if not model_id:
        model_id = await _cfg(db, "default_model_teacher")
    return provider, model_id


async def _model_prices(db: AsyncSession, provider: str, model_id: str) -> tuple[float, float]:
    m = (
        await db.execute(
            select(LLMModel).where(LLMModel.provider == provider, LLMModel.model_id == model_id)
        )
    ).scalar_one_or_none()
    return (m.input_per_1m_usd, m.output_per_1m_usd) if m else (0.0, 0.0)


@router.get("/models")
async def list_models(
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    """생기부 생성에 쓸 수 있는 모델 목록 (활성 provider의 활성 모델) + 기본값."""
    active_providers = set(
        (
            await db.execute(select(LLMProvider.provider).where(LLMProvider.is_active == True))  # noqa: E712
        ).scalars().all()
    )
    models = (
        await db.execute(
            select(LLMModel).where(LLMModel.is_active == True).order_by(LLMModel.sort_order)  # noqa: E712
        )
    ).scalars().all()
    out = [
        {"provider": m.provider, "model_id": m.model_id, "label": m.display_name}
        for m in models
        if m.provider in active_providers
    ]
    return {
        "models": out,
        "default_provider": await _cfg(db, "default_provider_teacher"),
        "default_model": await _cfg(db, "default_model_teacher"),
    }


@router.post("/projects/{pid}/columns/{cid}/generate")
async def generate_column(
    pid: int,
    cid: int,
    body: GenerateReq,
    user: User = Depends(require_permission("record.auto_generate")),
    db: AsyncSession = Depends(get_db),
):
    """열 일괄 AI 생성. 일반 항목은 셀 raw_data, 종합 항목은 다른 열 결과를 입력으로."""
    p = await get_owned_project(db, user, pid)
    col = await db.get(RecordColumn, cid)
    if not col or col.project_id != pid:
        raise HTTPException(404, "항목을 찾을 수 없습니다")

    provider, model_id = await _resolve_model(db, body.provider, body.model_id)
    if not provider or not model_id:
        raise HTTPException(400, "AI 모델이 지정되지 않았습니다. 모델을 선택하거나 챗봇 기본 모델을 설정하세요.")
    adapter = await get_adapter(db, provider)
    if adapter is None:
        raise HTTPException(400, f"'{provider}' API 키가 등록/활성화되지 않았습니다.")
    in_price, out_price = await _model_prices(db, provider, model_id)

    student_ids = list(
        (
            await db.execute(
                select(RecordProjectStudent.student_id).where(
                    RecordProjectStudent.project_id == pid
                )
            )
        ).scalars().all()
    )
    if body.only_student_ids:
        keep = set(body.only_student_ids)
        student_ids = [s for s in student_ids if s in keep]
    if not student_ids:
        return {"generated": 0, "total": 0, "cost_usd": 0.0, "errors": []}

    all_cols = (
        await db.execute(
            select(RecordColumn).where(RecordColumn.project_id == pid).order_by(RecordColumn.display_order)
        )
    ).scalars().all()
    all_cells = (
        await db.execute(select(RecordCell).where(RecordCell.project_id == pid))
    ).scalars().all()
    cells_idx: dict[tuple[int, int], RecordCell] = {
        (c.column_id, c.student_id): c for c in all_cells
    }

    system_text = build_system_prompt(
        p.global_prompt, col.system_prompt, col.char_min, col.char_max, col.kind
    )

    def user_text_for(sid: int) -> str:
        if col.kind == "summary":
            parts = []
            for oc in all_cols:
                if oc.id == cid or oc.kind == "summary":
                    continue
                cell = cells_idx.get((oc.id, sid))
                t = (cell.generated_text if cell else "") or ""
                if t.strip():
                    parts.append(f"[{oc.name}]\n{t.strip()}")
            return "\n\n".join(parts)
        cell = cells_idx.get((cid, sid))
        return (cell.raw_data if cell else "") or ""

    sem = asyncio.Semaphore(_CONCURRENCY)
    stats = {"cost": 0.0, "generated": 0, "errors": []}

    async def _one(sid: int):
        ut = user_text_for(sid)
        if not ut.strip():
            return
        async with sem:
            r = await _generate_one(adapter, model_id, system_text, ut, in_price, out_price)
        if r["error"] and not r["text"]:
            stats["errors"].append({"student_id": sid, "error": r["error"]})
            return
        cell = cells_idx.get((cid, sid))
        if not cell:
            cell = RecordCell(project_id=pid, column_id=cid, student_id=sid)
            db.add(cell)
            cells_idx[(cid, sid)] = cell
        cell.generated_text = r["text"]
        cell.status = "generated"
        stats["cost"] += r["cost"]
        stats["generated"] += 1

    await asyncio.gather(*[_one(s) for s in student_ids])
    await log_action(
        db, user, "record.generate",
        detail=f"생기부 항목 #{cid} AI 생성 {stats['generated']}명 (${stats['cost']:.4f})",
        is_sensitive=True,
    )
    await db.commit()
    return {
        "generated": stats["generated"],
        "total": len(student_ids),
        "cost_usd": round(stats["cost"], 4),
        "errors": stats["errors"][:10],
    }


@router.post("/projects/{pid}/compose-final")
async def compose_final(
    pid: int,
    body: ComposeFinalReq,
    user: User = Depends(require_permission("record.auto_generate")),
    db: AsyncSession = Depends(get_db),
):
    """행 단위 최종 종합 일괄 생성 — 학생별로 모든 항목 생성문을 하나로 통합해
    RecordProjectStudent.final_text에 저장 (참조 앱의 '종합(바이트조정)' 열 대응)."""
    p = await get_owned_project(db, user, pid)

    provider, model_id = await _resolve_model(db, body.provider, body.model_id)
    if not provider or not model_id:
        raise HTTPException(400, "AI 모델이 지정되지 않았습니다.")
    adapter = await get_adapter(db, provider)
    if adapter is None:
        raise HTTPException(400, f"'{provider}' API 키가 등록/활성화되지 않았습니다.")
    in_price, out_price = await _model_prices(db, provider, model_id)

    rows = (
        await db.execute(
            select(RecordProjectStudent).where(RecordProjectStudent.project_id == pid)
        )
    ).scalars().all()
    if body.only_student_ids:
        keep = set(body.only_student_ids)
        rows = [r for r in rows if r.student_id in keep]
    if not rows:
        return {"generated": 0, "total": 0, "cost_usd": 0.0, "errors": []}

    all_cols = (
        await db.execute(
            select(RecordColumn).where(RecordColumn.project_id == pid)
            .order_by(RecordColumn.display_order)
        )
    ).scalars().all()
    all_cells = (
        await db.execute(select(RecordCell).where(RecordCell.project_id == pid))
    ).scalars().all()
    cells_idx = {(c.column_id, c.student_id): c for c in all_cells}

    rng = ""
    if body.char_min or body.char_max:
        if body.char_max:
            rng = f"공백 포함 {body.char_min or 0}자 이상 {body.char_max}자 이하로 작성."
        else:
            rng = f"공백 포함 {body.char_min}자 이상으로 작성."
    system_text = "\n\n".join(filter(None, [
        _BASE_RULES,
        "[작성 형태] 아래 항목별 생활기록부 문장들을 하나의 매끄러운 최종 서술로 "
        "통합하라. 항목 머리말 없이 자연스럽게 이어지는 단일 문단. 핵심 의미는 "
        "유지하되 중복은 제거하고, 학생의 역량과 성장이 드러나게 재구성.",
        f"[분량] {rng}" if rng else "",
        f"[학교 공통 지침]\n{p.global_prompt.strip()}" if (p.global_prompt or "").strip() else "",
        "출력은 생활기록부 문장만. 머리말·설명·따옴표 없이 본문만.",
    ]))

    def user_text_for(sid: int) -> str:
        parts = []
        for oc in all_cols:
            cell = cells_idx.get((oc.id, sid))
            t = (cell.generated_text if cell else "") or ""
            if t.strip():
                parts.append(f"[{oc.name}]\n{t.strip()}")
        return "\n\n".join(parts)

    sem = asyncio.Semaphore(_CONCURRENCY)
    stats = {"cost": 0.0, "generated": 0, "errors": []}

    async def _one(row: RecordProjectStudent):
        ut = user_text_for(row.student_id)
        if not ut.strip():
            return
        async with sem:
            r = await _generate_one(adapter, model_id, system_text, ut, in_price, out_price)
        if r["error"] and not r["text"]:
            stats["errors"].append({"student_id": row.student_id, "error": r["error"]})
            return
        row.final_text = r["text"]
        stats["cost"] += r["cost"]
        stats["generated"] += 1

    await asyncio.gather(*[_one(r) for r in rows])
    await log_action(
        db, user, "record.compose_final",
        detail=f"생기부 #{pid} 최종 종합 생성 {stats['generated']}명 (${stats['cost']:.4f})",
        is_sensitive=True,
    )
    await db.commit()
    return {
        "generated": stats["generated"],
        "total": len(rows),
        "cost_usd": round(stats["cost"], 4),
        "errors": stats["errors"][:10],
    }


@router.put("/projects/{pid}/students/{student_id}/final-text")
async def update_final_text(
    pid: int,
    student_id: int,
    body: FinalTextUpdate,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """최종 종합 수동 편집 저장."""
    await get_owned_project(db, user, pid)
    row = (
        await db.execute(
            select(RecordProjectStudent).where(
                RecordProjectStudent.project_id == pid,
                RecordProjectStudent.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "학생을 찾을 수 없습니다")
    row.final_text = (body.final_text or "").strip() or None
    await db.commit()
    return {"ok": True, "final_text": row.final_text}


_SPELL_SYSTEM = (
    "당신은 한국어 교정 전문가입니다. 입력된 생활기록부 문장의 맞춤법·띄어쓰기·"
    "문법 오류만 교정합니다. 의미·문체·개조식 종결·분량은 바꾸지 마세요. "
    "교정된 문장만 출력하세요 (설명·따옴표·머리말 없이)."
)


@router.post("/spellcheck")
async def spellcheck(
    body: SpellcheckReq,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """LLM 기반 맞춤법 교정 (생기부 문장 1건)."""
    if not body.text or not body.text.strip():
        return {"corrected": "", "cost_usd": 0.0}
    provider, model_id = await _resolve_model(db, body.provider, body.model_id)
    if not provider or not model_id:
        raise HTTPException(400, "AI 모델이 지정되지 않았습니다.")
    adapter = await get_adapter(db, provider)
    if adapter is None:
        raise HTTPException(400, f"'{provider}' API 키가 등록/활성화되지 않았습니다.")
    in_price, out_price = await _model_prices(db, provider, model_id)
    r = await _generate_one(
        adapter, model_id, _SPELL_SYSTEM, body.text, in_price, out_price, temperature=0.1
    )
    if r["error"] and not r["text"]:
        raise HTTPException(502, f"맞춤법 교정 실패: {r['error']}")
    return {"corrected": r["text"], "cost_usd": round(r["cost"], 5)}
