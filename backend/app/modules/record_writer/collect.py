"""학생 제출물 자동 수집 — 열 source_config에 따라 셀 raw_data를 채운다.

source_config = {"type": "survey", "survey_id": N} 등.
지원 type: survey | assignment | artifact | career | club | group

각 소스에서 학생별 텍스트를 뽑아 RecordCell.raw_data + raw_sources에 저장.
extracted_text가 비어있는 과제는 summary/review_comment fallback.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom_surveys import (
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
)
from app.models.club import ClubActivity, ClubSubmission
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProjectStudent,
)
from app.models.student_self import StudentArtifact, StudentCareerPlan
from app.models.teacher_group import GroupSubmission
from app.models.user import User
from app.modules.record_writer._helpers import get_owned_project, members_user_ids
from app.modules.record_writer.router import router

MAX_CHARS = 6000  # 셀당 원자료 한도 (LLM 토큰 보호)


def _answer_text(a: SurveyAnswer) -> str:
    if a.text_value:
        return a.text_value.strip()
    if a.choice_values:
        return ", ".join(str(x) for x in a.choice_values)
    if a.rating_value is not None:
        return str(a.rating_value)
    return ""


async def _collect_survey(db, survey_id, student_ids) -> dict:
    out: dict[int, tuple[str, list]] = {}
    survey = await db.get(Survey, survey_id)
    title = survey.title if survey else f"설문#{survey_id}"
    questions = {
        q.id: q
        for q in (
            await db.execute(
                select(SurveyQuestion)
                .where(SurveyQuestion.survey_id == survey_id)
                .order_by(SurveyQuestion.order)
            )
        ).scalars().all()
    }
    responses = (
        await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == survey_id,
                SurveyResponse.respondent_id.in_(student_ids),
            )
        )
    ).scalars().all()
    for resp in responses:
        sid = resp.respondent_id
        if sid is None:
            continue
        answers = (
            await db.execute(
                select(SurveyAnswer).where(SurveyAnswer.response_id == resp.id)
            )
        ).scalars().all()
        lines = []
        for a in answers:
            q = questions.get(a.question_id)
            qtext = q.question_text if q else ""
            val = _answer_text(a)
            if val:
                lines.append(f"Q. {qtext}\nA. {val}")
        if lines:
            out[sid] = ("\n\n".join(lines), [{"source": "survey", "ref_id": survey_id, "title": title}])
    return out


async def _collect_assignment(db, assignment_id, student_ids) -> dict:
    out: dict[int, tuple[str, list]] = {}
    asg = await db.get(Assignment, assignment_id)
    title = asg.title if asg else f"과제#{assignment_id}"
    subs = (
        await db.execute(
            select(AssignmentSubmission).where(
                AssignmentSubmission.assignment_id == assignment_id,
                AssignmentSubmission.user_id.in_(student_ids),
            )
        )
    ).scalars().all()
    for s in subs:
        parts = []
        body = (s.summary or s.extracted_text or "").strip()
        if body:
            parts.append(body)
        if s.review_comment:
            parts.append(f"[교사 피드백] {s.review_comment.strip()}")
        if not parts:
            parts.append("(제출함 — 본문 텍스트 없음)")
        out[s.user_id] = ("\n\n".join(parts), [{"source": "assignment", "ref_id": assignment_id, "title": title}])
    return out


async def _collect_artifacts(db, student_ids) -> dict:
    out: dict[int, tuple[str, list]] = {}
    rows = (
        await db.execute(
            select(StudentArtifact)
            .where(StudentArtifact.student_id.in_(student_ids))
            .order_by(StudentArtifact.created_at)
        )
    ).scalars().all()
    byuser: dict[int, tuple[list, list]] = {}
    for a in rows:
        seg = a.title
        if a.description:
            seg += f": {a.description.strip()}"
        byuser.setdefault(a.student_id, ([], []))
        byuser[a.student_id][0].append(f"- {seg}")
        byuser[a.student_id][1].append({"source": "artifact", "ref_id": a.id, "title": a.title})
    for sid, (lines, srcs) in byuser.items():
        out[sid] = ("[산출물]\n" + "\n".join(lines), srcs)
    return out


async def _collect_career(db, student_ids, semester_id) -> dict:
    out: dict[int, tuple[str, list]] = {}
    rows = (
        await db.execute(
            select(StudentCareerPlan).where(StudentCareerPlan.student_id.in_(student_ids))
        )
    ).scalars().all()
    # 학생별 — 현 학기 우선, 없으면 첫 행
    best: dict[int, StudentCareerPlan] = {}
    for p in rows:
        cur = best.get(p.student_id)
        if cur is None or (p.semester_id == semester_id and cur.semester_id != semester_id):
            best[p.student_id] = p
    for sid, p in best.items():
        parts = []
        if p.desired_field:
            parts.append(f"희망 분야: {p.desired_field}")
        if p.career_goal:
            parts.append(f"진로 목표: {p.career_goal.strip()}")
        if p.target_universities:
            us = ", ".join(
                f"{u.get('university', '')} {u.get('major', '')}".strip()
                for u in p.target_universities
                if isinstance(u, dict)
            )
            if us.strip():
                parts.append(f"목표 대학: {us}")
        if p.academic_plan:
            parts.append(f"학업 계획: {p.academic_plan.strip()}")
        if p.activity_plan:
            parts.append(f"활동 계획: {p.activity_plan.strip()}")
        if p.motivation:
            parts.append(f"진학 동기: {p.motivation.strip()}")
        if parts:
            out[sid] = ("\n".join(parts), [{"source": "career", "ref_id": p.id, "title": "진로 설계"}])
    return out


async def _collect_club(db, club_id, student_ids) -> dict:
    out: dict[int, tuple[str, list]] = {}
    if not club_id:
        return out
    sid_set = set(student_ids)
    byuser: dict[int, tuple[list, list]] = {sid: ([], []) for sid in student_ids}
    subs = (
        await db.execute(
            select(ClubSubmission).where(
                ClubSubmission.club_id == club_id,
                ClubSubmission.author_id.in_(student_ids),
                ClubSubmission.status == "approved",
            )
        )
    ).scalars().all()
    for s in subs:
        if s.author_id in byuser:
            byuser[s.author_id][0].append(f"- 산출물: {s.title}")
            byuser[s.author_id][1].append({"source": "club_submission", "ref_id": s.id, "title": s.title})
    acts = (
        await db.execute(select(ClubActivity).where(ClubActivity.club_id == club_id))
    ).scalars().all()
    for a in acts:
        for sid in members_user_ids(a.attendees):
            if sid in sid_set:
                snippet = (a.content or "")[:200]
                byuser[sid][0].append(f"- 활동: {a.title} — {snippet}")
                byuser[sid][1].append({"source": "club_activity", "ref_id": a.id, "title": a.title})
    for sid, (lines, srcs) in byuser.items():
        if lines:
            out[sid] = ("[동아리]\n" + "\n".join(lines), srcs)
    return out


async def _collect_group(db, group_id, student_ids) -> dict:
    out: dict[int, tuple[str, list]] = {}
    if not group_id:
        return out
    subs = (
        await db.execute(
            select(GroupSubmission).where(
                GroupSubmission.group_id == group_id,
                GroupSubmission.student_id.in_(student_ids),
                GroupSubmission.status == "approved",
            )
        )
    ).scalars().all()
    byuser: dict[int, tuple[list, list]] = {}
    for s in subs:
        seg = s.title
        if s.description:
            seg += f": {s.description.strip()}"
        byuser.setdefault(s.student_id, ([], []))
        byuser[s.student_id][0].append(f"- {seg}")
        byuser[s.student_id][1].append({"source": "group_submission", "ref_id": s.id, "title": s.title})
    for sid, (lines, srcs) in byuser.items():
        out[sid] = ("[그룹 활동]\n" + "\n".join(lines), srcs)
    return out


@router.get("/projects/{pid}/source-candidates")
async def source_candidates(
    pid: int,
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    """항목 소스로 지정 가능한 설문·과제 목록 (본인 작성 + 범위 강좌)."""
    p = await get_owned_project(db, user, pid)
    sconds = [Survey.author_id == user.id]
    if p.scope_type == "course" and p.scope_ref_id:
        sconds.append(Survey.course_id == p.scope_ref_id)
    surveys = (
        await db.execute(
            select(Survey).where(Survey.deleted_at.is_(None), or_(*sconds))
        )
    ).scalars().all()
    asgs = (
        await db.execute(
            select(Assignment).where(Assignment.semester_id == p.semester_id)
        )
    ).scalars().all()
    return {
        "surveys": [{"id": s.id, "title": s.title} for s in surveys],
        "assignments": [{"id": a.id, "title": f"{a.subject} · {a.title}"} for a in asgs],
    }


@router.post("/projects/{pid}/columns/{cid}/collect")
async def collect_column(
    pid: int,
    cid: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """열 source_config에 따라 담당 학생 제출물을 셀에 자동 수집."""
    p = await get_owned_project(db, user, pid)
    col = await db.get(RecordColumn, cid)
    if not col or col.project_id != pid:
        raise HTTPException(404, "항목을 찾을 수 없습니다")
    cfg = col.source_config or {}
    src_type = cfg.get("type")
    if not src_type or src_type == "none":
        raise HTTPException(400, "이 항목에 데이터 소스가 설정되지 않았습니다. 항목 설정에서 소스를 지정하세요.")

    student_ids = list(
        (
            await db.execute(
                select(RecordProjectStudent.student_id).where(
                    RecordProjectStudent.project_id == pid
                )
            )
        ).scalars().all()
    )
    if not student_ids:
        return {"collected": 0, "total": 0}

    if src_type == "survey":
        if not cfg.get("survey_id"):
            raise HTTPException(400, "설문을 선택하세요")
        collected = await _collect_survey(db, cfg["survey_id"], student_ids)
    elif src_type == "assignment":
        if not cfg.get("assignment_id"):
            raise HTTPException(400, "과제를 선택하세요")
        collected = await _collect_assignment(db, cfg["assignment_id"], student_ids)
    elif src_type == "artifact":
        collected = await _collect_artifacts(db, student_ids)
    elif src_type == "career":
        collected = await _collect_career(db, student_ids, p.semester_id)
    elif src_type == "club":
        club_id = cfg.get("club_id") or (p.scope_ref_id if p.scope_type == "club" else None)
        collected = await _collect_club(db, club_id, student_ids)
    elif src_type == "group":
        group_id = cfg.get("group_id") or (p.scope_ref_id if p.scope_type == "group" else None)
        collected = await _collect_group(db, group_id, student_ids)
    else:
        raise HTTPException(400, f"지원하지 않는 소스 유형: {src_type}")

    existing = {
        c.student_id: c
        for c in (
            await db.execute(select(RecordCell).where(RecordCell.column_id == cid))
        ).scalars().all()
    }
    count = 0
    for sid in student_ids:
        item = collected.get(sid)
        if not item or not item[0]:
            continue
        text, srcs = item
        cell = existing.get(sid)
        if not cell:
            cell = RecordCell(project_id=pid, column_id=cid, student_id=sid)
            db.add(cell)
        cell.raw_data = text[:MAX_CHARS]
        cell.raw_sources = srcs
        if not cell.generated_text:
            cell.status = "collected"
        count += 1
    await db.commit()
    return {"collected": count, "total": len(student_ids)}
