"""문제은행 코스웨어 라우터.

엔드포인트:
  교사:
    GET  /api/courseware/courses/{cid}/problem-sets        — 강좌 ProblemSet list
    POST /api/courseware/courses/{cid}/problem-sets        — 생성 (problems inline)
    GET  /api/courseware/problem-sets/{psid}               — 단일 조회 (문제 본문 포함)
    PUT  /api/courseware/problem-sets/{psid}               — 편집
    DELETE /api/courseware/problem-sets/{psid}             — soft delete
    POST /api/courseware/problem-sets/{psid}/publish       — status=published
    POST /api/courseware/problem-sets/{psid}/close         — status=closed
    GET  /api/courseware/problem-sets/{psid}/results       — 학생별 결과 + 정답률 (Phase 4)
    POST /api/courseware/attempts/{attempt_id}/manual-grade — 주관식 수동 채점

  학생:
    GET  /api/courseware/problem-sets/{psid}/student-view  — 문제 본문 (정답·해설 마스킹)
    POST /api/courseware/problem-sets/{psid}/submit        — 답안 일괄 제출 + 자동 채점
    GET  /api/courseware/problem-sets/{psid}/my-attempts   — 본인 시도 + 결과

권한:
  - create/edit : 강좌 editor (owner + co_teacher) + admin
  - view        : 강좌 멤버 (수강생 포함)
  - submit      : 강좌 active 수강생
  - grade       : 강좌 editor + admin
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    Course, CourseProblemSet, CourseStudent, Problem,
    StudentProblemAttempt, User,
)
from app.modules.classroom.teachers import is_course_editor_or_admin
from app.modules.courseware.schemas import (
    ManualGradeReq, ProblemInline, ProblemSetCreate, ProblemSetUpdate,
    SubmitAttemptReq,
)
from app.services.courseware_grader import (
    AUTO_GRADER_TYPES, MANUAL_GRADER_TYPES, grade_answer,
)


router = APIRouter(prefix="/api/courseware", tags=["courseware"])


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


async def _assert_course_member(
    db: AsyncSession, user: User, course: Course,
) -> str:
    """admin / editor / student / 403. role 반환."""
    if _is_admin(user):
        return "admin"
    if await is_course_editor_or_admin(db, course, user):
        return "teacher"
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if cs:
        return "student"
    raise HTTPException(403, "강좌 멤버만 접근 가능")


async def _assert_editor(
    db: AsyncSession, user: User, course: Course,
) -> None:
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사·관리자만 가능")


def _set_to_dict(ps: CourseProblemSet, problem_count: int | None = None) -> dict:
    """list/get 응답. problems 본문은 별도 endpoint에서."""
    return {
        "id": ps.id,
        "course_id": ps.course_id,
        "title": ps.title,
        "description": ps.description,
        "problem_count": problem_count if problem_count is not None else len(ps.problem_ids or []),
        "status": ps.status,
        "due_date": ps.due_date.isoformat() if ps.due_date else None,
        "time_limit_seconds": ps.time_limit_seconds,
        "max_attempts": ps.max_attempts,
        "show_solution_after_due": ps.show_solution_after_due,
        "settings": ps.settings or {},
        "created_by": ps.created_by,
        "created_at": ps.created_at.isoformat() if ps.created_at else None,
        "updated_at": ps.updated_at.isoformat() if ps.updated_at else None,
    }


def _problem_to_full(p: Problem) -> dict:
    """교사 view — 정답·해설 포함."""
    return {
        "id": p.id,
        "type": p.question_type,
        "content": p.content,
        "solution": p.solution,
        "answer": p.answer,
        "answer_data": p.answer_data,
        "difficulty": p.difficulty,
        "subject": p.subject,
        "tags": p.tags or [],
    }


def _problem_to_student(p: Problem, reveal_solution: bool) -> dict:
    """학생 view — 정답·해설은 reveal_solution=True일 때만.

    answer_data에서는 객관식 choices(보기) 정보만 노출 (정답 set은 숨김).
    """
    base = {
        "id": p.id,
        "type": p.question_type,
        "content": p.content,
        "difficulty": p.difficulty,
        "subject": p.subject,
        "tags": p.tags or [],
    }
    # 객관식 보기는 answer_data.choices에 별도 저장 (정답과 분리 — UI 표시용)
    if p.answer_data and isinstance(p.answer_data, dict):
        choices = p.answer_data.get("choices")
        if choices:
            base["choices"] = choices
    if reveal_solution:
        base["solution"] = p.solution
        base["answer"] = p.answer
        base["answer_data"] = p.answer_data
    return base


async def _create_problem_inline(
    db: AsyncSession, p: ProblemInline, created_by: int,
) -> Problem:
    """inline ProblemInline → archive.Problem row 생성."""
    obj = Problem(
        department="math",  # 기본값 — 향후 확장
        subject=p.subject or "",
        difficulty=p.difficulty,
        question_type=p.type,
        content=p.content,
        solution=p.solution,
        answer=p.answer,
        answer_data=p.answer_data,
        tags=p.tags,
        is_visible=True,
        review_status="pending",
        created_by_id=created_by,
    )
    db.add(obj)
    await db.flush()
    return obj


def _max_possible_score(problems: list[Problem]) -> int:
    """자동채점 가능 + 수동까지 합쳐 최대 점수 (정수, 문제당 1점 기준)."""
    return len(problems)


async def _load_problems_for_set(
    db: AsyncSession, ps: CourseProblemSet,
) -> list[Problem]:
    """ps.problem_ids 순서대로 Problem 로드 (없으면 skip)."""
    ids = ps.problem_ids or []
    if not ids:
        return []
    rows = (await db.execute(
        select(Problem).where(Problem.id.in_(ids))
    )).scalars().all()
    by_id = {p.id: p for p in rows}
    return [by_id[i] for i in ids if i in by_id]


# ─────────────────────────────────────────────────────────────────────────────
# 교사 — ProblemSet CRUD
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/my-problem-sets")
async def my_problem_sets(
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인 관련 ProblemSet 강좌별 그룹화.

    - 교사·admin: 본인이 가르치는 강좌(owner OR co_teacher) 또는 admin이면 전체
      · status 무관 (draft 포함) — 출제 관리용
    - 학생: 본인 active 수강 강좌 + status in (published, closed) 만
    """
    from app.models import CourseTeacher, Semester

    is_admin = _is_admin(user)
    is_student = user.role == "student"

    # 강좌 id 결정
    if is_admin:
        course_rows = (await db.execute(
            select(Course).where(Course.is_active == True)  # noqa: E712
        )).scalars().all()
    elif is_student:
        cs_rows = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        if not cs_rows:
            return {"courses": []}
        course_rows = (await db.execute(
            select(Course).where(Course.id.in_(cs_rows))
        )).scalars().all()
    else:
        # 교사·직원: owner + co_teacher
        owner_cids = (await db.execute(
            select(Course.id).where(Course.teacher_id == user.id)
        )).scalars().all()
        co_cids = (await db.execute(
            select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
        )).scalars().all()
        ids = list(set(list(owner_cids) + list(co_cids)))
        if not ids:
            return {"courses": []}
        course_rows = (await db.execute(
            select(Course).where(Course.id.in_(ids))
        )).scalars().all()

    if not course_rows:
        return {"courses": []}

    # 학기 정보 (그룹화·정렬용)
    sem_ids = list({c.semester_id for c in course_rows if c.semester_id})
    semesters = (await db.execute(
        select(Semester).where(Semester.id.in_(sem_ids))
    )).scalars().all() if sem_ids else []
    sem_by_id = {s.id: s for s in semesters}

    # ProblemSet 일괄 로드
    cids = [c.id for c in course_rows]
    q = select(CourseProblemSet).where(
        CourseProblemSet.course_id.in_(cids),
        CourseProblemSet.deleted_at.is_(None),
    )
    if is_student:
        q = q.where(CourseProblemSet.status.in_(["published", "closed"]))
    q = q.order_by(CourseProblemSet.course_id, CourseProblemSet.created_at.desc())
    set_rows = (await db.execute(q)).scalars().all()

    sets_by_cid: dict[int, list[CourseProblemSet]] = {}
    for ps in set_rows:
        sets_by_cid.setdefault(ps.course_id, []).append(ps)

    # 응답 — 강좌별 그룹 (문제 세트 없는 강좌도 admin/teacher 입장에선 표시)
    out_courses: list[dict] = []
    for c in course_rows:
        sem = sem_by_id.get(c.semester_id) if c.semester_id else None
        sets = sets_by_cid.get(c.id, [])
        if is_student and not sets:
            continue  # 학생은 게시된 세트 있는 강좌만
        out_courses.append({
            "course_id": c.id,
            "course_name": c.name,
            "subject": c.subject,
            "class_name": c.class_name,
            "semester": {
                "id": sem.id, "year": sem.year, "term": sem.term, "name": sem.name,
            } if sem else None,
            "is_active": c.is_active,
            "sets": [_set_to_dict(ps) for ps in sets],
        })

    # 활성 강좌 우선, 학기 내림차순
    out_courses.sort(
        key=lambda x: (
            not x["is_active"],
            -(x["semester"]["year"] if x["semester"] else 0),
            -(x["semester"]["term"] if x["semester"] else 0),
            x["course_name"],
        )
    )
    return {"courses": out_courses}


@router.get("/courses/{cid}/problem-sets")
async def list_problem_sets(
    cid: int,
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """강좌의 문제 세트 list. status 필터링은 frontend에서.

    학생에겐 draft 숨김 (published/closed만).
    """
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    role = await _assert_course_member(db, user, course)

    q = select(CourseProblemSet).where(
        CourseProblemSet.course_id == cid,
        CourseProblemSet.deleted_at.is_(None),
    )
    if role == "student":
        q = q.where(CourseProblemSet.status.in_(["published", "closed"]))
    q = q.order_by(CourseProblemSet.created_at.desc())
    rows = (await db.execute(q)).scalars().all()
    return {"items": [_set_to_dict(ps) for ps in rows]}


@router.post("/courses/{cid}/problem-sets")
async def create_problem_set(
    cid: int, body: ProblemSetCreate, request: Request,
    user: User = Depends(require_permission("classroom.courseware.create")),
    db: AsyncSession = Depends(get_db),
):
    """문제 세트 생성 — problems list를 inline으로 받아 Problem row를 함께 생성."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    await _assert_editor(db, user, course)

    # 1) 각 ProblemInline → Problem row
    problem_ids: list[int] = []
    for p in body.problems:
        obj = await _create_problem_inline(db, p, created_by=user.id)
        problem_ids.append(obj.id)

    # 2) ProblemSet
    ps = CourseProblemSet(
        course_id=cid,
        title=body.title,
        description=body.description,
        problem_ids=problem_ids,
        status=body.status,
        due_date=body.due_date,
        time_limit_seconds=body.time_limit_seconds,
        max_attempts=body.max_attempts,
        show_solution_after_due=body.show_solution_after_due,
        settings=body.settings,
        created_by=user.id,
    )
    db.add(ps)
    await db.flush()

    await log_action(
        db, user, "courseware.problem_set.create",
        target=f"course:{cid} set:{ps.id} problems:{len(problem_ids)}",
        request=request,
    )
    return _set_to_dict(ps, problem_count=len(problem_ids))


@router.get("/problem-sets/{psid}")
async def get_problem_set(
    psid: int,
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """교사용 — 정답·해설·answer_data 포함 단일 조회 (편집/결과 분석 UI)."""
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    role = await _assert_course_member(db, user, course)
    if role == "student":
        # 학생이 본 endpoint 직접 호출 시 정보 부족 — student-view로 안내
        raise HTTPException(403, "학생은 /student-view 사용")

    problems = await _load_problems_for_set(db, ps)
    return {
        **_set_to_dict(ps, problem_count=len(problems)),
        "problems": [_problem_to_full(p) for p in problems],
    }


@router.put("/problem-sets/{psid}")
async def update_problem_set(
    psid: int, body: ProblemSetUpdate, request: Request,
    user: User = Depends(require_permission("classroom.courseware.edit")),
    db: AsyncSession = Depends(get_db),
):
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)

    patch = body.model_dump(exclude_unset=True)
    # problems는 별도 처리 — 기존 problems 유지? 또는 교체?
    # 정책: problems=None이면 유지, list 주어지면 전체 교체 (기존 Problem rows는 보존 — 향후 garbage 정리 cron 가능)
    new_problems = patch.pop("problems", None)

    for k, v in patch.items():
        setattr(ps, k, v)

    if new_problems is not None:
        # 새 inline problems 작성 (Pydantic 변환)
        new_ids: list[int] = []
        for raw in new_problems:
            pi = ProblemInline(**raw) if isinstance(raw, dict) else raw
            obj = await _create_problem_inline(db, pi, created_by=user.id)
            new_ids.append(obj.id)
        ps.problem_ids = new_ids

    ps.updated_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, user, "courseware.problem_set.update",
        target=f"set:{psid}", request=request,
    )
    return _set_to_dict(ps)


@router.delete("/problem-sets/{psid}")
async def delete_problem_set(
    psid: int, request: Request,
    user: User = Depends(require_permission("classroom.courseware.edit")),
    db: AsyncSession = Depends(get_db),
):
    """soft delete — drive 패턴. 30일 후 trash purge cron이 hard delete."""
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)

    ps.deleted_at = datetime.now(timezone.utc)
    ps.deleted_by = user.id
    await db.flush()

    await log_action(
        db, user, "courseware.problem_set.delete",
        target=f"set:{psid}", request=request,
    )
    return {"ok": True}


@router.post("/problem-sets/{psid}/publish")
async def publish_problem_set(
    psid: int, request: Request,
    user: User = Depends(require_permission("classroom.courseware.edit")),
    db: AsyncSession = Depends(get_db),
):
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)
    ps.status = "published"
    await db.flush()
    await log_action(db, user, "courseware.problem_set.publish", target=f"set:{psid}", request=request)
    return _set_to_dict(ps)


@router.post("/problem-sets/{psid}/close")
async def close_problem_set(
    psid: int, request: Request,
    user: User = Depends(require_permission("classroom.courseware.edit")),
    db: AsyncSession = Depends(get_db),
):
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)
    ps.status = "closed"
    await db.flush()
    await log_action(db, user, "courseware.problem_set.close", target=f"set:{psid}", request=request)
    return _set_to_dict(ps)


# ─────────────────────────────────────────────────────────────────────────────
# 학생 — 풀이 + 제출
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/problem-sets/{psid}/student-view")
async def get_problem_set_student_view(
    psid: int,
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 풀이 view — 정답·해설 마스킹. 본인 시도 횟수도 포함."""
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    role = await _assert_course_member(db, user, course)

    if role == "student" and ps.status == "draft":
        raise HTTPException(403, "아직 게시되지 않은 문제 세트")

    now = datetime.now(timezone.utc)
    is_past_due = ps.due_date is not None and ps.due_date < now
    reveal = ps.show_solution_after_due and is_past_due

    problems = await _load_problems_for_set(db, ps)

    # 본인 시도 횟수
    attempt_count = 0
    if role == "student":
        cnt = (await db.execute(
            select(StudentProblemAttempt.attempt_number).where(
                StudentProblemAttempt.problem_set_id == psid,
                StudentProblemAttempt.student_id == user.id,
            )
        )).scalars().all()
        attempt_count = max(cnt) if cnt else 0

    return {
        **_set_to_dict(ps, problem_count=len(problems)),
        "problems": [_problem_to_student(p, reveal) for p in problems],
        "is_past_due": is_past_due,
        "solution_revealed": reveal,
        "attempts_used": attempt_count,
        "attempts_left": max(0, ps.max_attempts - attempt_count),
    }


@router.post("/problem-sets/{psid}/submit")
async def submit_problem_set(
    psid: int, body: SubmitAttemptReq, request: Request,
    background: BackgroundTasks,
    user: User = Depends(require_permission("classroom.courseware.submit")),
    db: AsyncSession = Depends(get_db),
):
    """학생 답안 일괄 제출 + 자동 채점.

    - 한 시도(attempt) = problem_set 전체 한 번 풀이. attempt_number 증가.
    - draft / closed 상태면 거부.
    - max_attempts 초과 시 거부.
    - 각 문제별로 grade_answer 호출, StudentProblemAttempt row 저장.
    - 응답: per-problem 결과 + 합계 점수.
    """
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    role = await _assert_course_member(db, user, course)
    if role != "student" and not _is_admin(user):
        # 교사도 테스트로 풀어볼 수 있게 허용 — 점수만 별도 처리 가능 (현재는 동일)
        pass
    if ps.status != "published":
        raise HTTPException(409, "게시 중인 문제 세트만 제출 가능")
    if ps.due_date and ps.due_date < datetime.now(timezone.utc):
        raise HTTPException(409, "마감 시간이 지난 문제 세트")

    # 이전 attempts 카운트
    prev = (await db.execute(
        select(StudentProblemAttempt.attempt_number).where(
            StudentProblemAttempt.problem_set_id == psid,
            StudentProblemAttempt.student_id == user.id,
        )
    )).scalars().all()
    used = max(prev) if prev else 0
    if used >= ps.max_attempts:
        raise HTTPException(409, "재응시 한도 초과")
    attempt_n = used + 1

    # 채점
    problems = await _load_problems_for_set(db, ps)
    by_id: dict[int, Problem] = {p.id: p for p in problems}
    answer_by_pid = {a.problem_id: a.answer for a in body.answers}

    # ProblemSet.settings.llm_grader_enabled이면 학생 제출 시 background LLM 채점
    llm_grader_enabled = bool((ps.settings or {}).get("llm_grader_enabled"))

    results: list[dict] = []
    auto_score_sum = 0.0
    auto_graded = 0
    auto_correct = 0
    manual_pending = 0
    llm_pending = 0

    for p in problems:
        sub = answer_by_pid.get(p.id)
        is_correct, score = grade_answer(p.answer_data, sub)
        has_manual = (
            isinstance(p.answer_data, dict)
            and (p.answer_data.get("grader_type") or "").lower() in MANUAL_GRADER_TYPES
        )

        # LLM 채점 대상 — manual grader + llm_grader_enabled
        grading_status = "none"
        if is_correct is None and has_manual and llm_grader_enabled:
            grading_status = "pending"

        att = StudentProblemAttempt(
            problem_set_id=psid,
            problem_id=p.id,
            student_id=user.id,
            attempt_number=attempt_n,
            answer_data=sub,
            is_correct=is_correct,
            auto_score=score,
            grading_status=grading_status,
            graded_at=datetime.now(timezone.utc) if is_correct is not None else None,
        )
        db.add(att)

        if is_correct is None:
            if has_manual:
                manual_pending += 1
                if grading_status == "pending":
                    llm_pending += 1
        else:
            auto_graded += 1
            if is_correct:
                auto_correct += 1
            auto_score_sum += score

        results.append({
            "problem_id": p.id,
            "is_correct": is_correct,
            "auto_score": score,
            "has_manual_pending": has_manual,
            "llm_grading": grading_status == "pending",
        })

    await db.flush()
    await log_action(
        db, user, "courseware.attempt.submit",
        target=f"set:{psid} attempt:{attempt_n}",
        detail=f"correct={auto_correct}/{auto_graded} pending={manual_pending} llm={llm_pending}",
        request=request,
    )

    # LLM 채점 background spawn (response sent 후 실행) — pending이 1개 이상일 때만
    if llm_pending > 0:
        from app.services.llm_grader import grade_pending_for_student
        background.add_task(grade_pending_for_student, psid, user.id, attempt_n)

    return {
        "ok": True,
        "attempt_number": attempt_n,
        "total_problems": len(problems),
        "auto_graded": auto_graded,
        "auto_correct": auto_correct,
        "auto_score_sum": auto_score_sum,
        "manual_pending": manual_pending,
        "llm_pending": llm_pending,
        "llm_grading_started": llm_pending > 0,
        "results": results,
    }


@router.get("/problem-sets/{psid}/my-attempts")
async def my_attempts(
    psid: int,
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 시도 + 결과. 정답·해설은 show_solution_after_due 정책 따름."""
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_course_member(db, user, course)

    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == psid,
            StudentProblemAttempt.student_id == user.id,
        ).order_by(
            StudentProblemAttempt.attempt_number.asc(),
            StudentProblemAttempt.problem_id.asc(),
        )
    )).scalars().all()

    items = [
        {
            "attempt_number": r.attempt_number,
            "problem_id": r.problem_id,
            "answer_data": r.answer_data,
            "is_correct": r.is_correct,
            "auto_score": r.auto_score,
            "manual_score": r.manual_score,
            "manual_feedback": r.manual_feedback,
            "grading_status": r.grading_status,
            "llm_metadata": r.llm_metadata,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "graded_at": r.graded_at.isoformat() if r.graded_at else None,
        }
        for r in rows
    ]
    return {"items": items, "attempts_used": max((r.attempt_number for r in rows), default=0)}


# ─────────────────────────────────────────────────────────────────────────────
# 교사 — 결과 분석 (Phase 4)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/problem-sets/{psid}/results")
async def problem_set_results(
    psid: int,
    user: User = Depends(require_permission("classroom.courseware.grade")),
    db: AsyncSession = Depends(get_db),
):
    """학생별 점수 + 문제별 정답률.

    구조:
      {
        "students": [{student_id, name, attempts, best_score, latest_attempt_at}, ...],
        "problems": [{problem_id, total_submissions, correct_count, accuracy}, ...],
      }
    """
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)

    # 모든 attempts
    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == psid,
        )
    )).scalars().all()

    # 학생 이름 조인
    student_ids = list({r.student_id for r in rows})
    name_by_id: dict[int, str] = {}
    if student_ids:
        users = (await db.execute(
            select(User.id, User.name).where(User.id.in_(student_ids))
        )).all()
        name_by_id = {u[0]: u[1] for u in users}

    # 학생별 집계 (best score = attempt당 score 합 최대)
    per_student: dict[int, dict] = {}
    for r in rows:
        s = per_student.setdefault(r.student_id, {
            "student_id": r.student_id,
            "name": name_by_id.get(r.student_id, f"#{r.student_id}"),
            "attempts": {},  # attempt_n → score sum
            "latest_attempt_at": None,
        })
        att_n = r.attempt_number
        cur = s["attempts"].get(att_n, {"score_sum": 0.0, "correct": 0, "manual_pending": 0})
        if r.is_correct is True:
            cur["correct"] += 1
            cur["score_sum"] += (r.auto_score or 0.0)
        elif r.is_correct is False:
            cur["score_sum"] += (r.auto_score or 0.0)
        else:
            # manual_score 반영
            if r.manual_score is not None:
                cur["score_sum"] += r.manual_score
            else:
                cur["manual_pending"] += 1
        s["attempts"][att_n] = cur
        if r.submitted_at and (s["latest_attempt_at"] is None or r.submitted_at > s["latest_attempt_at"]):
            s["latest_attempt_at"] = r.submitted_at

    students_out = []
    for s in per_student.values():
        best = max(
            (a["score_sum"] for a in s["attempts"].values()),
            default=0.0,
        )
        students_out.append({
            "student_id": s["student_id"],
            "name": s["name"],
            "attempts_count": len(s["attempts"]),
            "best_score": best,
            "latest_attempt_at": s["latest_attempt_at"].isoformat() if s["latest_attempt_at"] else None,
        })

    # 문제별 정답률 (latest attempt 기준은 복잡 → 모든 attempts 단순 평균)
    per_problem: dict[int, dict] = {}
    for r in rows:
        p = per_problem.setdefault(r.problem_id, {
            "problem_id": r.problem_id, "total_submissions": 0, "correct_count": 0,
        })
        p["total_submissions"] += 1
        if r.is_correct is True:
            p["correct_count"] += 1

    problems_out = []
    for p in per_problem.values():
        total = p["total_submissions"]
        problems_out.append({
            "problem_id": p["problem_id"],
            "total_submissions": total,
            "correct_count": p["correct_count"],
            "accuracy": (p["correct_count"] / total) if total > 0 else 0.0,
        })

    return {"students": students_out, "problems": problems_out}


@router.get("/me/wrong-attempts")
async def my_wrong_attempts(
    course_id: int | None = None,
    subject: str | None = None,
    limit: int = 100,
    user: User = Depends(require_permission("classroom.courseware.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 풀어본 문제 중 틀린 것 모음 (오답 노트).

    - 같은 (problem_set, problem)의 여러 시도 중 최신 attempt만
    - 자동채점 결과 False만 (수동채점 대기·정답은 제외)
    - 정답·해설은 ps.show_solution_after_due + 마감 지난 경우만 노출
    - 필터: course_id, subject (Problem.subject)
    """
    from sqlalchemy import desc

    q = select(StudentProblemAttempt).where(
        StudentProblemAttempt.student_id == user.id,
        StudentProblemAttempt.is_correct == False,  # noqa: E712
    ).order_by(
        StudentProblemAttempt.problem_set_id.desc(),
        StudentProblemAttempt.problem_id.asc(),
        desc(StudentProblemAttempt.attempt_number),
    )
    rows = (await db.execute(q)).scalars().all()

    # 같은 (psid, pid)는 최신 attempt만
    seen: set[tuple[int, int]] = set()
    latest: list[StudentProblemAttempt] = []
    for r in rows:
        key = (r.problem_set_id, r.problem_id)
        if key in seen:
            continue
        seen.add(key)
        latest.append(r)
        if len(latest) >= limit:
            break

    if not latest:
        return {"items": []}

    # 관련 문제 + 세트 + 강좌 일괄 로드
    pids = list({a.problem_id for a in latest})
    psids = list({a.problem_set_id for a in latest})

    problems_rows = (await db.execute(
        select(Problem).where(Problem.id.in_(pids))
    )).scalars().all()
    p_by_id = {p.id: p for p in problems_rows}

    sets_rows = (await db.execute(
        select(CourseProblemSet).where(CourseProblemSet.id.in_(psids))
    )).scalars().all()
    s_by_id = {s.id: s for s in sets_rows}

    cids = list({s.course_id for s in sets_rows})
    courses_rows = (await db.execute(
        select(Course).where(Course.id.in_(cids))
    )).scalars().all()
    c_by_id = {c.id: c for c in courses_rows}

    now = datetime.now(timezone.utc)
    items: list[dict] = []
    for a in latest:
        p = p_by_id.get(a.problem_id)
        ps = s_by_id.get(a.problem_set_id)
        if not p or not ps:
            continue
        if course_id is not None and ps.course_id != course_id:
            continue
        if subject and (p.subject or "") != subject:
            continue
        course = c_by_id.get(ps.course_id)
        # 정답·해설 노출 정책 — student-view와 동일
        is_past_due = ps.due_date is not None and ps.due_date < now
        reveal = bool(ps.show_solution_after_due and is_past_due)

        items.append({
            "attempt_id": a.id,
            "attempt_number": a.attempt_number,
            "problem_set_id": ps.id,
            "problem_set_title": ps.title,
            "course_id": ps.course_id,
            "course_name": course.name if course else f"#{ps.course_id}",
            "problem_id": p.id,
            "problem_type": p.question_type,
            "subject": p.subject,
            "difficulty": p.difficulty,
            "content": p.content,
            "answer_data_view": {
                "choices": (p.answer_data or {}).get("choices")
                if p.answer_data else None,
            },
            "your_answer": a.answer_data,
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "answer": p.answer if reveal else None,
            "solution": p.solution if reveal else None,
            "revealed": reveal,
        })

    return {"items": items}


@router.get("/problem-sets/{psid}/students/{sid}/attempts")
async def student_attempts(
    psid: int, sid: int,
    user: User = Depends(require_permission("classroom.courseware.grade")),
    db: AsyncSession = Depends(get_db),
):
    """교사가 특정 학생의 모든 시도+답안 조회 (수동 채점 UI용)."""
    ps = await db.get(CourseProblemSet, psid)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)

    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.problem_set_id == psid,
            StudentProblemAttempt.student_id == sid,
        ).order_by(
            StudentProblemAttempt.attempt_number.asc(),
            StudentProblemAttempt.problem_id.asc(),
        )
    )).scalars().all()

    items = [
        {
            "id": r.id,
            "attempt_number": r.attempt_number,
            "problem_id": r.problem_id,
            "answer_data": r.answer_data,
            "is_correct": r.is_correct,
            "auto_score": r.auto_score,
            "manual_score": r.manual_score,
            "manual_feedback": r.manual_feedback,
            "graded_by": r.graded_by,
            "grading_status": r.grading_status,
            "llm_metadata": r.llm_metadata,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "graded_at": r.graded_at.isoformat() if r.graded_at else None,
        }
        for r in rows
    ]
    return {"items": items}


@router.post("/attempts/{attempt_id}/manual-grade")
async def manual_grade_attempt(
    attempt_id: int, body: ManualGradeReq, request: Request,
    user: User = Depends(require_permission("classroom.courseware.grade")),
    db: AsyncSession = Depends(get_db),
):
    """주관식 attempt 1개 수동 채점 (score 0.0~1.0 정규화)."""
    if body.attempt_id != attempt_id:
        raise HTTPException(400, "URL과 body attempt_id 불일치")

    att = await db.get(StudentProblemAttempt, attempt_id)
    if not att:
        raise HTTPException(404)

    ps = await db.get(CourseProblemSet, att.problem_set_id)
    if not ps:
        raise HTTPException(404)
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_editor(db, user, course)

    att.manual_score = body.score
    att.manual_feedback = body.feedback
    att.graded_by = user.id
    att.graded_at = datetime.now(timezone.utc)
    await db.flush()

    await log_action(
        db, user, "courseware.attempt.manual_grade",
        target=f"attempt:{attempt_id} score:{body.score}",
        request=request,
    )
    return {"ok": True, "manual_score": att.manual_score}


# Sub-routers — 같은 router 인스턴스에 endpoint 추가 (chatbots 패턴 동일)
from app.modules.courseware import bank  # noqa: E402,F401
from app.modules.courseware import io    # noqa: E402,F401
from app.modules.courseware import llm   # noqa: E402,F401
