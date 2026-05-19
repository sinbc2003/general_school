"""Survey question CRUD — draft 상태에서만 변경 가능."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom_surveys import Survey, SurveyQuestion
from app.models.user import User
from app.modules.classroom_surveys._helpers import can_manage, question_to_dict
from app.modules.classroom_surveys.router import router
from app.modules.classroom_surveys.schemas import QuestionCreate, QuestionUpdate


@router.post("/{sid}/questions")
async def add_question(
    sid: int, body: QuestionCreate, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not can_manage(user, s):
        raise HTTPException(403, "본인 설문만 질문 추가")
    if s.status != "draft":
        raise HTTPException(409, "초안 상태에서만 질문 추가 가능")

    next_order = body.order
    if next_order is None:
        max_order = (await db.execute(
            select(func.coalesce(func.max(SurveyQuestion.order), -1)).where(
                SurveyQuestion.survey_id == sid,
            )
        )).scalar_one()
        next_order = (max_order or -1) + 1

    q = SurveyQuestion(
        survey_id=sid,
        order=next_order,
        question_text=body.question_text,
        question_type=body.question_type,
        is_required=body.is_required,
        options=body.options if body.question_type in ("single_choice", "multi_choice") else None,
        rating_max=body.rating_max,
    )
    db.add(q)
    await db.flush()
    return question_to_dict(q)


@router.put("/questions/{qid}")
async def update_question(
    qid: int, body: QuestionUpdate,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    q = await db.get(SurveyQuestion, qid)
    if not q:
        raise HTTPException(404)
    s = await db.get(Survey, q.survey_id)
    if not s or not can_manage(user, s):
        raise HTTPException(403)
    if s.status != "draft":
        raise HTTPException(409, "초안 상태에서만 질문 편집 가능")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(q, k, v)
    await db.flush()
    return question_to_dict(q)


@router.delete("/questions/{qid}")
async def delete_question(
    qid: int,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    q = await db.get(SurveyQuestion, qid)
    if not q:
        raise HTTPException(404)
    s = await db.get(Survey, q.survey_id)
    if not s or not can_manage(user, s):
        raise HTTPException(403)
    if s.status != "draft":
        raise HTTPException(409, "초안 상태에서만 질문 삭제 가능")
    await db.delete(q)
    return {"ok": True}
