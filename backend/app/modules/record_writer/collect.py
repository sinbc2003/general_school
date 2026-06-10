"""학생 제출물 자동 수집 — 열 source_config에 따라 셀 raw_data를 채운다.

source_config = {"type": "survey", "survey_id": N} 등.
지원 type: survey | assignment | artifact | career | club | group
           | classroom | classroom_submission | coursework

각 소스에서 학생별 텍스트를 뽑아 RecordCell.raw_data + raw_sources에 저장.
extracted_text가 비어있는 과제는 summary/review_comment fallback.

클래스룸 소스 (general_school 내부 클래스룸 — Google Classroom 아님):
- classroom            : 범위 강좌의 학생 활동 전부 (과제 제출 + 코스웨어 점수) 통합 수집
- classroom_submission : 특정 강좌 글(과제)의 제출물 (첨부 문서 plain_text + 피드백 + 점수)
- coursework           : 특정 문제세트의 학생 점수·정오답 요약

collect_into_cells()는 엔드포인트(열 일괄)와 자동 push(record_autocollect, 단일 학생)가
공유한다 — 두 경로의 수집 결과가 동일하도록.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Course, CoursePost, CoursePostSubmission
from app.models.classroom_docs import ClassroomDocument
from app.models.classroom_sheets import ClassroomSheet
from app.models.classroom_slides import ClassroomPresentation, ClassroomSlide
from app.models.classroom_surveys import (
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
)
from app.models.club import ClubActivity, ClubSubmission
from app.models.courseware import CourseProblemSet, StudentProblemAttempt
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProject,
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


# ── 클래스룸 첨부 텍스트 추출 ──────────────────────────────────────────────

async def _attachment_text(db, att: dict) -> str:
    """클래스룸 첨부 1건 → 생기부 원자료에 쓸 텍스트.

    협업 문서/슬라이드는 plain_text를, 그 외(시트/HWP/파일/링크)는 제목·파일명만.
    """
    if not isinstance(att, dict):
        return ""
    t = att.get("type")
    title = att.get("title") or ""
    if t == "doc" and att.get("doc_id"):
        d = await db.get(ClassroomDocument, att["doc_id"])
        if d and d.plain_text:
            return f"[문서: {d.title}]\n{d.plain_text.strip()}"
        return f"[문서: {title}]"
    if t == "deck" and att.get("deck_id"):
        d = await db.get(ClassroomPresentation, att["deck_id"])
        slides = (await db.execute(
            select(ClassroomSlide.plain_text)
            .where(ClassroomSlide.presentation_id == att["deck_id"])
            .order_by(ClassroomSlide.order)
        )).scalars().all() if d else []
        body = "\n".join(s.strip() for s in slides if s)
        return f"[프리젠테이션: {title}]\n{body}".strip() if body else f"[프리젠테이션: {title}]"
    if t == "sheet":
        return f"[스프레드시트: {title}]"
    if t == "hwp":
        return f"[한컴문서: {title}]"
    if t == "file":
        return f"[첨부파일: {att.get('file_name') or title}]"
    if t == "link" and att.get("url"):
        return f"[링크: {title} {att['url']}]"
    return f"[{title}]" if title else ""


async def _submission_text(db, sub: CoursePostSubmission) -> str:
    """과제 제출 1건 → 첨부 본문 + 학생별 사본 + 점수·피드백."""
    parts: list[str] = []
    for att in (sub.attachments or []):
        seg = await _attachment_text(db, att)
        if seg:
            parts.append(seg)
    # 학생별 사본(share_mode=copy) 문서 본문
    from app.models.classroom import PostAttachmentCopy
    copies = (await db.execute(
        select(PostAttachmentCopy).where(
            PostAttachmentCopy.post_id == sub.post_id,
            PostAttachmentCopy.student_id == sub.student_id,
        )
    )).scalars().all()
    for cp in copies:
        if cp.copy_type == "doc":
            d = await db.get(ClassroomDocument, cp.copy_id)
            if d and d.plain_text:
                parts.append(f"[사본: {d.title}]\n{d.plain_text.strip()}")
    if sub.score is not None:
        parts.append(f"[점수] {sub.score}")
    if sub.feedback:
        parts.append(f"[교사 피드백] {sub.feedback.strip()}")
    return "\n\n".join(p for p in parts if p)


async def _collect_classroom_submission(db, post_id, student_ids) -> dict:
    """특정 강좌 글(과제)의 학생 제출물 수집."""
    out: dict[int, tuple[str, list]] = {}
    post = await db.get(CoursePost, post_id)
    title = post.title if post else f"과제#{post_id}"
    subs = (await db.execute(
        select(CoursePostSubmission).where(
            CoursePostSubmission.post_id == post_id,
            CoursePostSubmission.student_id.in_(student_ids),
        )
    )).scalars().all()
    for s in subs:
        text = await _submission_text(db, s)
        if text:
            out[s.student_id] = (text, [{"source": "classroom_submission", "ref_id": post_id, "title": title}])
    return out


async def _collect_coursework(db, set_id, student_ids) -> dict:
    """특정 문제세트의 학생 점수·정오답 요약."""
    out: dict[int, tuple[str, list]] = {}
    ps = await db.get(CourseProblemSet, set_id)
    title = ps.title if ps else f"문제세트#{set_id}"
    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == set_id,
            StudentProblemAttempt.student_id.in_(student_ids),
        )
    )).scalars().all()
    byuser: dict[int, list] = {}
    for a in rows:
        byuser.setdefault(a.student_id, []).append(a)
    for sid, attempts in byuser.items():
        total = len(attempts)
        correct = sum(1 for a in attempts if a.is_correct)
        score = sum((a.manual_score if a.manual_score is not None else a.auto_score) or 0 for a in attempts)
        out[sid] = (
            f"[{title}] 문항 {total}개 중 정답 {correct}개, 획득점수 {score:g}",
            [{"source": "coursework", "ref_id": set_id, "title": title}],
        )
    return out


async def _collect_classroom_all(db, course_id, student_ids) -> dict:
    """범위 강좌의 학생 활동 전부 — 모든 과제 제출 + 모든 문제세트 점수 통합."""
    out: dict[int, tuple[list, list]] = {sid: ([], []) for sid in student_ids}
    if not course_id:
        return {}
    # 1) 강좌의 과제 글들
    posts = (await db.execute(
        select(CoursePost).where(
            CoursePost.course_id == course_id,
            CoursePost.post_type == "assignment_ref",
        )
    )).scalars().all()
    for post in posts:
        sub_map = await _collect_classroom_submission(db, post.id, student_ids)
        for sid, (text, srcs) in sub_map.items():
            out[sid][0].append(f"[과제: {post.title}]\n{text}")
            out[sid][1].extend(srcs)
    # 2) 강좌의 문제세트들
    sets = (await db.execute(
        select(CourseProblemSet).where(
            CourseProblemSet.course_id == course_id,
            CourseProblemSet.deleted_at.is_(None),
        )
    )).scalars().all()
    for ps in sets:
        cw_map = await _collect_coursework(db, ps.id, student_ids)
        for sid, (text, srcs) in cw_map.items():
            out[sid][0].append(text)
            out[sid][1].extend(srcs)
    return {
        sid: ("[클래스룸 활동]\n" + "\n\n".join(lines), srcs)
        for sid, (lines, srcs) in out.items()
        if lines
    }


async def collect_into_cells(
    db: AsyncSession,
    project: RecordProject,
    column: RecordColumn,
    student_ids: list[int],
) -> int:
    """열 source_config에 따라 student_ids의 셀 raw_data를 채운다 (commit은 호출자).

    엔드포인트(열 전체)와 자동 push(단일 학생) 공유 — 동일한 수집 결과 보장.
    """
    cfg = column.source_config or {}
    src_type = cfg.get("type")
    if not src_type or src_type == "none" or not student_ids:
        return 0

    if src_type == "survey":
        if not cfg.get("survey_id"):
            return 0
        collected = await _collect_survey(db, cfg["survey_id"], student_ids)
    elif src_type == "assignment":
        if not cfg.get("assignment_id"):
            return 0
        collected = await _collect_assignment(db, cfg["assignment_id"], student_ids)
    elif src_type == "artifact":
        collected = await _collect_artifacts(db, student_ids)
    elif src_type == "career":
        collected = await _collect_career(db, student_ids, project.semester_id)
    elif src_type == "club":
        club_id = cfg.get("club_id") or (project.scope_ref_id if project.scope_type == "club" else None)
        collected = await _collect_club(db, club_id, student_ids)
    elif src_type == "group":
        group_id = cfg.get("group_id") or (project.scope_ref_id if project.scope_type == "group" else None)
        collected = await _collect_group(db, group_id, student_ids)
    elif src_type == "classroom_submission":
        if not cfg.get("post_id"):
            return 0
        collected = await _collect_classroom_submission(db, cfg["post_id"], student_ids)
    elif src_type == "coursework":
        if not cfg.get("set_id"):
            return 0
        collected = await _collect_coursework(db, cfg["set_id"], student_ids)
    elif src_type == "classroom":
        course_id = cfg.get("course_id") or (project.scope_ref_id if project.scope_type == "course" else None)
        collected = await _collect_classroom_all(db, course_id, student_ids)
    else:
        return 0

    existing = {
        c.student_id: c
        for c in (
            await db.execute(
                select(RecordCell).where(
                    RecordCell.column_id == column.id,
                    RecordCell.student_id.in_(student_ids),
                )
            )
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
            cell = RecordCell(project_id=project.id, column_id=column.id, student_id=sid)
            db.add(cell)
        cell.raw_data = text[:MAX_CHARS]
        cell.raw_sources = srcs
        if not cell.generated_text:
            cell.status = "collected"
        count += 1
    return count


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

    # 클래스룸 과제 글 + 문제세트 (범위 강좌 기준) — "클래스룸 활동" 수집 소스
    classroom_posts: list[dict] = []
    coursework_sets: list[dict] = []
    course_id = p.scope_ref_id if p.scope_type == "course" else None
    if course_id:
        posts = (await db.execute(
            select(CoursePost).where(
                CoursePost.course_id == course_id,
                CoursePost.post_type == "assignment_ref",
            )
        )).scalars().all()
        classroom_posts = [{"id": cp.id, "title": cp.title} for cp in posts]
        sets = (await db.execute(
            select(CourseProblemSet).where(
                CourseProblemSet.course_id == course_id,
                CourseProblemSet.deleted_at.is_(None),
            )
        )).scalars().all()
        coursework_sets = [{"id": s.id, "title": s.title} for s in sets]

    return {
        "surveys": [{"id": s.id, "title": s.title} for s in surveys],
        "assignments": [{"id": a.id, "title": f"{a.subject} · {a.title}"} for a in asgs],
        "classroom_posts": classroom_posts,
        "coursework_sets": coursework_sets,
        # 범위가 강좌면 "클래스룸 활동 전체" 통합 수집 가능
        "classroom_course_id": course_id,
    }


@router.post("/projects/{pid}/columns/{cid}/collect")
async def collect_column(
    pid: int,
    cid: int,
    user: User = Depends(require_permission("record.project.manage")),
    db: AsyncSession = Depends(get_db),
):
    """열 source_config에 따라 담당 학생 제출물을 셀에 일괄 자동 수집 (수동 트리거)."""
    p = await get_owned_project(db, user, pid)
    col = await db.get(RecordColumn, cid)
    if not col or col.project_id != pid:
        raise HTTPException(404, "항목을 찾을 수 없습니다")
    if not (col.source_config or {}).get("type") or (col.source_config or {}).get("type") == "none":
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

    count = await collect_into_cells(db, p, col, student_ids)
    await db.commit()
    return {"collected": count, "total": len(student_ids)}
