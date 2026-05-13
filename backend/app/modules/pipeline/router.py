"""파이프라인 라우터 — AI 작업 관리"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.pipeline import PipelineJob, JobStatus, AgentResult, LLMUsageLog, PromptTemplate
from app.models.user import User

router = APIRouter(prefix="/api/pipeline", tags=["pipeline"])


@router.get("/jobs")
async def list_jobs(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = None, job_type: str | None = None,
    user: User = Depends(require_permission("pipeline.job.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(PipelineJob)
    cq = select(func.count(PipelineJob.id))
    if status:
        q = q.where(PipelineJob.status == status)
        cq = cq.where(PipelineJob.status == status)
    if job_type:
        q = q.where(PipelineJob.job_type == job_type)
        cq = cq.where(PipelineJob.job_type == job_type)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(PipelineJob.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": j.id, "job_type": j.job_type, "status": j.status.value,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
        } for j in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/jobs/{jid}")
async def get_job(
    jid: int,
    user: User = Depends(require_permission("pipeline.job.view")),
    db: AsyncSession = Depends(get_db),
):
    j = (await db.execute(select(PipelineJob).where(PipelineJob.id == jid))).scalar_one_or_none()
    if not j:
        raise HTTPException(404, "작업을 찾을 수 없습니다")
    results = (await db.execute(
        select(AgentResult).where(AgentResult.job_id == jid)
    )).scalars().all()
    return {
        "id": j.id, "job_type": j.job_type, "status": j.status.value,
        "input_data": j.input_data, "output_data": j.output_data,
        "error_message": j.error_message,
        "results": [{
            "id": r.id, "agent_type": r.agent_type,
            "confidence": r.confidence, "cost": r.cost,
        } for r in results],
    }


@router.post("/trigger")
async def trigger_job(
    body: dict,
    user: User = Depends(require_permission("pipeline.job.trigger")),
    db: AsyncSession = Depends(get_db),
):
    j = PipelineJob(
        job_type=body["job_type"],
        input_data=body.get("input_data"),
        document_id=body.get("document_id"),
        triggered_by_id=user.id,
    )
    db.add(j)
    await db.flush()
    return {"id": j.id, "status": j.status.value}


# ── Cost Stats ──

@router.get("/cost")
async def cost_summary(
    user: User = Depends(require_permission("pipeline.cost.view")),
    db: AsyncSession = Depends(get_db),
):
    total_cost = (await db.execute(select(func.sum(LLMUsageLog.cost)))).scalar() or 0
    total_input = (await db.execute(select(func.sum(LLMUsageLog.input_tokens)))).scalar() or 0
    total_output = (await db.execute(select(func.sum(LLMUsageLog.output_tokens)))).scalar() or 0
    return {
        "total_cost": round(float(total_cost), 4),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
    }


# ── Prompts ──

@router.get("/prompts")
async def list_prompts(
    user: User = Depends(require_permission("pipeline.prompt.edit")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(PromptTemplate).order_by(PromptTemplate.agent_type))).scalars().all()
    return [{
        "id": p.id, "name": p.name, "agent_type": p.agent_type,
        "template": p.template, "version": p.version, "is_active": p.is_active,
    } for p in rows]


@router.put("/prompts/{pid}")
async def update_prompt(
    pid: int, body: dict,
    user: User = Depends(require_permission("pipeline.prompt.edit")),
    db: AsyncSession = Depends(get_db),
):
    p = (await db.execute(select(PromptTemplate).where(PromptTemplate.id == pid))).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    if "template" in body:
        p.template = body["template"]
        p.version += 1
    if "is_active" in body:
        p.is_active = body["is_active"]
    await db.flush()
    return {"ok": True}
