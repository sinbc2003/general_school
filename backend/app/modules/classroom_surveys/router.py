"""클래스룸 설문지 라우터.

경로:
  GET    /api/classroom/surveys                       내가 만든/응답 가능한 설문 목록
  POST   /api/classroom/surveys                       설문 생성
  GET    /api/classroom/surveys/{sid}                 설문 상세 (질문 포함) + my_response
  PUT    /api/classroom/surveys/{sid}                 메타 편집 (작성자/admin)
  DELETE /api/classroom/surveys/{sid}                 삭제 (작성자/admin)

  POST   /api/classroom/surveys/{sid}/questions       질문 추가
  PUT    /api/classroom/surveys/questions/{qid}       질문 편집
  DELETE /api/classroom/surveys/questions/{qid}       질문 삭제

  POST   /api/classroom/surveys/{sid}/responses       응답 제출
  GET    /api/classroom/surveys/{sid}/results         결과 (작성자/admin)
  GET    /api/classroom/surveys/{sid}/results.csv     결과 CSV 다운로드

권한 정책:
  - 작성자 + admin: 모든 CRUD + 결과 조회
  - 일반 사용자: 활성(status=active) + access_mode 통과 시 응답 가능
  - 익명(is_anonymous=True) 시 respondent_id=null로 저장
  - allow_multiple_responses=False + 실명 모드면 중복 차단
"""

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CourseStudent
from app.models.classroom_surveys import (
    Survey, SurveyAnswer, SurveyQuestion, SurveyResponse,
)
from app.models.user import User
from app.modules.classroom_surveys.schemas import (
    AnswerIn, QuestionCreate, QuestionUpdate, ResponseSubmit, SurveyCreate, SurveyUpdate,
)

router = APIRouter(prefix="/api/classroom/surveys", tags=["classroom-surveys"])


# ── helpers ────────────────────────────────────────────────


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


def _can_manage(user: User, survey: Survey) -> bool:
    """작성자 또는 관리자만 편집/삭제/결과 조회 가능."""
    return _is_admin(user) or survey.author_id == user.id


def _survey_to_dict(s: Survey, *, author_name: str | None = None) -> dict:
    return {
        "id": s.id,
        "course_id": s.course_id,
        "author_id": s.author_id,
        "author_name": author_name,
        "title": s.title,
        "description": s.description,
        "status": s.status,
        "is_anonymous": s.is_anonymous,
        "allow_multiple_responses": s.allow_multiple_responses,
        "access_mode": s.access_mode,
        "open_at": s.open_at.isoformat() if s.open_at else None,
        "close_at": s.close_at.isoformat() if s.close_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _question_to_dict(q: SurveyQuestion) -> dict:
    return {
        "id": q.id,
        "survey_id": q.survey_id,
        "order": q.order,
        "question_text": q.question_text,
        "question_type": q.question_type,
        "is_required": q.is_required,
        "options": q.options or [],
        "rating_max": q.rating_max,
    }


async def _can_respond(db: AsyncSession, user: User, survey: Survey) -> bool:
    """응답 자격 검증.

    - status=active 필수
    - open_at <= now <= close_at (각각 null이면 무제한)
    - access_mode=course_members: 강좌 학생 OR 교사 OR admin
    - access_mode=link_public: 인증된 모든 사용자
    """
    if survey.status != "active":
        return False
    now = datetime.now(timezone.utc)
    if survey.open_at and survey.open_at > now:
        return False
    if survey.close_at and survey.close_at < now:
        return False
    if _is_admin(user) or survey.author_id == user.id:
        return True
    if survey.access_mode == "link_public":
        return True
    # course_members
    if survey.course_id is None:
        # 단독 설문이면서 course_members 모드면 작성자만 가능 (위에서 분기)
        return False
    course = await db.get(Course, survey.course_id)
    if not course:
        return False
    if course.teacher_id == user.id:
        return True
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == survey.course_id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    return cs is not None


# ── Survey CRUD ───────────────────────────────────────────


@router.get("")
async def list_surveys(
    course_id: int | None = Query(None),
    mine: bool = Query(False, description="True면 내가 만든 설문만"),
    status_filter: str | None = Query(None, alias="status"),
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 접근 가능한 설문 목록.

    - 작성자 OR 강좌 멤버 OR admin OR (link_public + active)
    """
    base = select(Survey)
    if course_id is not None:
        base = base.where(Survey.course_id == course_id)
    if status_filter:
        base = base.where(Survey.status == status_filter)

    if _is_admin(user):
        q = base
    elif mine:
        q = base.where(Survey.author_id == user.id)
    else:
        teacher_course_ids = (await db.execute(
            select(Course.id).where(Course.teacher_id == user.id)
        )).scalars().all()
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        conds = [Survey.author_id == user.id]
        if course_ids:
            conds.append(
                (Survey.access_mode == "course_members") &
                (Survey.course_id.in_(course_ids))
            )
        # link_public + active는 인증된 누구나 (단축 링크 시나리오)
        conds.append(
            (Survey.access_mode == "link_public") & (Survey.status == "active")
        )
        q = base.where(or_(*conds))

    q = q.order_by(desc(Survey.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    author_ids = {s.author_id for s in rows}
    authors: dict[int, str] = {}
    if author_ids:
        urows = (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all()
        authors = {u.id: u.name for u in urows}

    return {"items": [_survey_to_dict(s, author_name=authors.get(s.author_id)) for s in rows]}


@router.post("")
async def create_survey(
    body: SurveyCreate, request: Request,
    user: User = Depends(require_permission("classroom.survey.create")),
    db: AsyncSession = Depends(get_db),
):
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not _is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌만 설문 생성 가능")

    s = Survey(
        course_id=body.course_id,
        author_id=user.id,
        title=body.title,
        description=body.description,
        is_anonymous=body.is_anonymous,
        allow_multiple_responses=body.allow_multiple_responses,
        access_mode=body.access_mode,
    )
    db.add(s)
    await db.flush()
    await log_action(
        db, user, "classroom.survey.create",
        target=f"survey:{s.id}", request=request,
    )
    return _survey_to_dict(s, author_name=user.name)


@router.get("/{sid}")
async def get_survey(
    sid: int,
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)

    is_author = _can_manage(user, s)
    can_respond_now = await _can_respond(db, user, s)
    if not is_author and not can_respond_now:
        # access_mode=link_public + draft/closed 같은 경우도 차단
        raise HTTPException(403, "설문 접근 권한이 없습니다")

    # 질문 (작성자는 draft 포함, 응답자는 active일 때만 노출 — 이미 위에서 차단)
    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
        .order_by(SurveyQuestion.order, SurveyQuestion.id)
    )).scalars().all()

    # 본인 응답 기록 (있으면 중복 응답 방지 알림용)
    my_response = None
    if not s.is_anonymous:
        mr = (await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == sid,
                SurveyResponse.respondent_id == user.id,
            ).order_by(desc(SurveyResponse.submitted_at)).limit(1)
        )).scalar_one_or_none()
        if mr:
            my_response = {
                "id": mr.id,
                "submitted_at": mr.submitted_at.isoformat() if mr.submitted_at else None,
            }

    author = await db.get(User, s.author_id)
    return {
        **_survey_to_dict(s, author_name=author.name if author else None),
        "questions": [_question_to_dict(q) for q in qs],
        "is_author": is_author,
        "can_respond": can_respond_now and (s.allow_multiple_responses or my_response is None),
        "my_response": my_response,
    }


@router.put("/{sid}")
async def update_survey(
    sid: int, body: SurveyUpdate, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not _can_manage(user, s):
        raise HTTPException(403, "본인 설문만 편집 가능")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(s, k, v)
    await db.flush()
    await log_action(db, user, "classroom.survey.update", target=f"survey:{sid}", request=request)
    return _survey_to_dict(s)


@router.delete("/{sid}")
async def delete_survey(
    sid: int, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not _can_manage(user, s):
        raise HTTPException(403, "본인 설문만 삭제 가능")
    await db.delete(s)
    await log_action(db, user, "classroom.survey.delete", target=f"survey:{sid}", request=request)
    return {"ok": True}


# ── Question CRUD ─────────────────────────────────────────


@router.post("/{sid}/questions")
async def add_question(
    sid: int, body: QuestionCreate, request: Request,
    user: User = Depends(require_permission("classroom.survey.edit")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not _can_manage(user, s):
        raise HTTPException(403, "본인 설문만 질문 추가")
    if s.status != "draft":
        # 활성·마감된 설문에 질문 추가는 응답자 혼선 → 차단 (draft로 되돌리고 추가)
        raise HTTPException(409, "초안 상태에서만 질문 추가 가능")

    # order 자동 부여
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
    return _question_to_dict(q)


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
    if not s or not _can_manage(user, s):
        raise HTTPException(403)
    if s.status != "draft":
        raise HTTPException(409, "초안 상태에서만 질문 편집 가능")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(q, k, v)
    await db.flush()
    return _question_to_dict(q)


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
    if not s or not _can_manage(user, s):
        raise HTTPException(403)
    if s.status != "draft":
        raise HTTPException(409, "초안 상태에서만 질문 삭제 가능")
    await db.delete(q)
    return {"ok": True}


# ── Response 제출 ─────────────────────────────────────────


@router.post("/{sid}/responses")
async def submit_response(
    sid: int, body: ResponseSubmit, request: Request,
    user: User = Depends(require_permission("classroom.survey.respond")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not await _can_respond(db, user, s):
        raise HTTPException(403, "응답 자격 없음 (활성·기간·접근 모드 확인)")

    # 중복 차단: 실명 + allow_multiple_responses=False
    if not s.is_anonymous and not s.allow_multiple_responses:
        dup = (await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == sid,
                SurveyResponse.respondent_id == user.id,
            )
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(409, "이미 응답하셨습니다 (중복 응답 불가 설정)")

    # 질문 조회 (검증용)
    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
    )).scalars().all()
    qmap = {q.id: q for q in qs}

    # 필수 질문 모두 답했는지 + 답 타입 검증
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
        # 타입별 답 정규화
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

        # 필수인데 값 없으면 차단
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


# ── Results (작성자/admin) ────────────────────────────────


@router.get("/{sid}/results")
async def get_results(
    sid: int,
    user: User = Depends(require_permission("classroom.survey.view_results")),
    db: AsyncSession = Depends(get_db),
):
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not _can_manage(user, s):
        raise HTTPException(403, "본인 설문 결과만 조회 가능")

    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
        .order_by(SurveyQuestion.order, SurveyQuestion.id)
    )).scalars().all()

    # 응답 + 답변 일괄 조회
    responses = (await db.execute(
        select(SurveyResponse).where(SurveyResponse.survey_id == sid)
        .order_by(desc(SurveyResponse.submitted_at))
    )).scalars().all()
    response_ids = [r.id for r in responses]
    answers = []
    if response_ids:
        answers = (await db.execute(
            select(SurveyAnswer).where(SurveyAnswer.response_id.in_(response_ids))
        )).scalars().all()

    # 응답자 이름 (실명 모드만)
    respondent_ids = {r.respondent_id for r in responses if r.respondent_id}
    respondents: dict[int, str] = {}
    if respondent_ids and not s.is_anonymous:
        urows = (await db.execute(
            select(User).where(User.id.in_(respondent_ids))
        )).scalars().all()
        respondents = {u.id: u.name for u in urows}

    # 질문별 답 집계
    answers_by_qid: dict[int, list[SurveyAnswer]] = {}
    for a in answers:
        answers_by_qid.setdefault(a.question_id, []).append(a)

    question_summary = []
    for q in qs:
        ans = answers_by_qid.get(q.id, [])
        summary: dict = {
            **_question_to_dict(q),
            "response_count": len(ans),
        }
        if q.question_type in ("single_choice", "multi_choice"):
            # 옵션별 카운트
            counts: dict[str, int] = {opt: 0 for opt in (q.options or [])}
            for a in ans:
                for v in (a.choice_values or []):
                    if v in counts:
                        counts[v] += 1
                    else:
                        counts.setdefault(v, 0)
                        counts[v] += 1
            summary["choice_counts"] = counts
        elif q.question_type == "rating":
            ratings = [a.rating_value for a in ans if a.rating_value is not None]
            counts = {i: 0 for i in range(1, q.rating_max + 1)}
            for r in ratings:
                if 1 <= r <= q.rating_max:
                    counts[r] += 1
            summary["rating_counts"] = counts
            summary["rating_avg"] = round(sum(ratings) / len(ratings), 2) if ratings else None
        else:
            # short_text / long_text / date: 텍스트 리스트
            summary["text_values"] = [a.text_value for a in ans if a.text_value]
        question_summary.append(summary)

    return {
        "survey": _survey_to_dict(s),
        "response_count": len(responses),
        "questions": question_summary,
        "responses": [
            {
                "id": r.id,
                "respondent_id": r.respondent_id,
                "respondent_name": (
                    respondents.get(r.respondent_id) if r.respondent_id else None
                ),
                "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            }
            for r in responses
        ],
    }


@router.get("/{sid}/results.csv")
async def export_results_csv(
    sid: int,
    user: User = Depends(require_permission("classroom.survey.view_results")),
    db: AsyncSession = Depends(get_db),
):
    """결과 CSV 다운로드.

    한 행 = 한 응답. 열 = 응답자(또는 익명) + 제출시각 + 질문별 답.
    multi_choice는 ' | '로 join.
    """
    s = await db.get(Survey, sid)
    if not s:
        raise HTTPException(404)
    if not _can_manage(user, s):
        raise HTTPException(403)

    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == sid)
        .order_by(SurveyQuestion.order, SurveyQuestion.id)
    )).scalars().all()

    responses = (await db.execute(
        select(SurveyResponse).where(SurveyResponse.survey_id == sid)
        .order_by(SurveyResponse.submitted_at)
    )).scalars().all()
    response_ids = [r.id for r in responses]
    answers = []
    if response_ids:
        answers = (await db.execute(
            select(SurveyAnswer).where(SurveyAnswer.response_id.in_(response_ids))
        )).scalars().all()

    answers_by_resp: dict[int, dict[int, SurveyAnswer]] = {}
    for a in answers:
        answers_by_resp.setdefault(a.response_id, {})[a.question_id] = a

    respondent_ids = {r.respondent_id for r in responses if r.respondent_id}
    respondents: dict[int, str] = {}
    if respondent_ids and not s.is_anonymous:
        urows = (await db.execute(
            select(User).where(User.id.in_(respondent_ids))
        )).scalars().all()
        respondents = {u.id: u.name for u in urows}

    buf = io.StringIO()
    # Excel UTF-8 BOM
    buf.write("﻿")
    w = csv.writer(buf)
    header = ["응답ID", "응답자", "제출시각"]
    for q in qs:
        header.append(q.question_text)
    w.writerow(header)

    for r in responses:
        row = [
            r.id,
            "(익명)" if s.is_anonymous else respondents.get(r.respondent_id or 0, ""),
            r.submitted_at.isoformat() if r.submitted_at else "",
        ]
        ans_map = answers_by_resp.get(r.id, {})
        for q in qs:
            a = ans_map.get(q.id)
            if not a:
                row.append("")
            elif q.question_type in ("short_text", "long_text", "date"):
                row.append(a.text_value or "")
            elif q.question_type in ("single_choice", "multi_choice"):
                row.append(" | ".join(a.choice_values or []))
            elif q.question_type == "rating":
                row.append(str(a.rating_value) if a.rating_value is not None else "")
            else:
                row.append("")
        w.writerow(row)

    buf.seek(0)
    filename = f"survey_{sid}_results.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
