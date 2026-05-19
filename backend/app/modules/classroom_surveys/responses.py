"""Survey response 제출 — 필수 질문 검증 + 중복 차단 + 익명 처리."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom_surveys import (
    Survey, SurveyAnswer, SurveyQuestion, SurveyResponse,
)
from app.models.user import User
from app.modules.classroom_surveys._helpers import can_respond
from app.modules.classroom_surveys.router import router
from app.modules.classroom_surveys.schemas import ResponseSubmit


@router.post("/{sid}/responses")
async def submit_response(
    sid: int, body: ResponseSubmit, request: Request,
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not await can_respond(db, user, s):
        raise HTTPException(403, "응답 자격 없음 (활성·기간·접근 모드 확인)")

    # 중복 차단: 실명 + allow_multiple=False
    if not s.is_anonymous and not s.allow_multiple_responses:
        dup = (await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == sid,
                SurveyResponse.respondent_id == user.id,
            )
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(409, "이미 응답하셨습니다 (중복 응답 불가 설정)")

    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
    )).scalars().all()
    qmap = {q.id: q for q in qs}

    answered_qids = {a.question_id for a in body.answers}
    for q in qs:
        if q.is_required and q.id not in answered_qids:
            raise HTTPException(400, f"필수 질문 미응답: '{q.question_text}'")

    resp = SurveyResponse(
        survey_id=sid,
        respondent_id=None if s.is_anonymous else user.id,
    )
    db.add(resp)
    await db.flush()

    for a in body.answers:
        q = qmap.get(a.question_id)
        if not q:
            raise HTTPException(400, f"잘못된 question_id: {a.question_id}")
        text_v = None
        choice_v = None
        rating_v = None
        if q.question_type in ("short_text", "long_text", "date"):
            text_v = (a.text_value or "").strip() or None
        elif q.question_type == "single_choice":
            if a.choice_values and len(a.choice_values) >= 1:
                choice_v = [a.choice_values[0]]
        elif q.question_type == "multi_choice":
            choice_v = a.choice_values or []
        elif q.question_type == "rating":
            if a.rating_value is not None:
                rating_v = max(1, min(q.rating_max, int(a.rating_value)))

        if q.is_required and not (text_v or choice_v or rating_v):
            raise HTTPException(400, f"필수 질문 답 없음: '{q.question_text}'")

        db.add(SurveyAnswer(
            response_id=resp.id, question_id=q.id,
            text_value=text_v, choice_values=choice_v, rating_value=rating_v,
        ))

    await db.flush()
    await log_action(
        db, user, "classroom.survey.respond",
        target=f"survey:{sid} response:{resp.id}", request=request,
    )
    return {"ok": True, "response_id": resp.id}
