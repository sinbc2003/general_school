"""문제은행 코스웨어 — 데모 데이터 seed (dev 검토용).

POST /api/courseware/_demo/seed — super_admin 전용
  · 호출자의 첫 active 강좌에 Problem 10개 + ProblemSet 3개 + 학생 attempt 다양성 생성
  · 학생 attempt: 정답·오답·needs_review·LLM done 섞어서 UI 다양성 확보
  · 멱등 — 이미 demo Problem이 있으면 skip (Problem.extra.demo=True 마크)

운영 환경에서 실수 방지: super_admin만 호출 가능 + 호출 결과에 created count 표시.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from sqlalchemy import String, cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_super_admin
from app.models import (
    Course, CourseProblemSet, CourseStudent, CourseTeacher, Problem,
    StudentProblemAttempt, User,
)
from app.modules.courseware.router import router


# ── 데모용 SVG 이미지 (학교 LAN 외부 차단 대비, storage에 멱등 저장) ─────────
# settings.STORAGE_ROOT 기반 (Phase 2-Q 통합).
from app.core.files import DEFAULT_STORAGE_ROOT

_COURSEWARE_STORAGE = DEFAULT_STORAGE_ROOT / "courseware"

_DEMO_IMG_TRIANGLE = (
    """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 100" width="260">
  <polygon points="20,80 110,80 110,15" fill="none" stroke="#222" stroke-width="1.8"/>
  <rect x="100" y="70" width="10" height="10" fill="none" stroke="#888" stroke-width="0.8"/>
  <text x="55" y="92" font-size="11" fill="#222">4</text>
  <text x="116" y="50" font-size="11" fill="#222">3</text>
  <text x="50" y="50" font-size="13" font-style="italic" fill="#0066cc">x</text>
</svg>"""
).encode("utf-8")

_DEMO_IMG_LINE = (
    """<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="220">
  <line x1="10" y1="90" x2="92" y2="90" stroke="#888" stroke-width="0.6"/>
  <line x1="10" y1="8"  x2="10" y2="90" stroke="#888" stroke-width="0.6"/>
  <line x1="10" y1="90" x2="80" y2="20" stroke="#0066cc" stroke-width="2"/>
  <circle cx="10" cy="90" r="2" fill="#0066cc"/>
  <circle cx="80" cy="20" r="2" fill="#0066cc"/>
  <text x="86" y="96" font-size="7" fill="#666">x</text>
  <text x="3"  y="14" font-size="7" fill="#666">y</text>
  <text x="82" y="36" font-size="7" fill="#0066cc" font-style="italic">B(7,7)</text>
  <text x="14" y="98" font-size="7" fill="#0066cc" font-style="italic">A(0,0)</text>
</svg>"""
).encode("utf-8")

_DEMO_IMAGES: dict[str, bytes] = {
    "demo-triangle.svg": _DEMO_IMG_TRIANGLE,
    "demo-line.svg": _DEMO_IMG_LINE,
}


async def _ensure_demo_images() -> None:
    """데모 SVG를 storage/courseware/에 멱등 작성 (이미 있으면 skip)."""
    await ensure_dir_async(_COURSEWARE_STORAGE)
    for name, blob in _DEMO_IMAGES.items():
        target = _COURSEWARE_STORAGE / name
        if not target.exists():
            await write_bytes_async(target, blob)


# ── 데모 Problem 정의 (10개, 다양한 grader_type) ─────────────────────────────

DEMO_PROBLEMS: list[dict] = [
    {
        "content": "1+1은?",
        "answer": "2",
        "answer_data": {
            "grader_type": "choices",
            "correct": ["B"],
            "choices": ["A. 1", "B. 2", "C. 3", "D. 4"],
        },
        "question_type": "multiple_choice",
        "difficulty": "easy",
        "subject": "수학",
        "solution": "덧셈의 정의에 따라 1+1=2.",
    },
    {
        "content": "다음 중 소수가 아닌 것은?",
        "answer": "4",
        "answer_data": {
            "grader_type": "choices",
            "correct": ["B"],
            "choices": ["A. 2", "B. 4", "C. 7", "D. 11"],
        },
        "question_type": "multiple_choice",
        "difficulty": "easy",
        "subject": "수학",
    },
    {
        "content": "원주율을 소수 둘째자리까지 쓰시오.",
        "answer": "3.14",
        "answer_data": {
            "grader_type": "numeric",
            "value": 3.14,
            "tolerance": 0.005,
        },
        "question_type": "numeric",
        "difficulty": "medium",
        "subject": "수학",
    },
    {
        "content": "0.1 + 0.2 = ?",
        "answer": "0.3",
        "answer_data": {
            "grader_type": "numeric",
            "value": 0.3,
            "tolerance": 0.001,
        },
        "question_type": "numeric",
        "difficulty": "easy",
        "subject": "수학",
        "tags": ["부동소수점"],
    },
    {
        "content": "조선왕조 4대 왕의 이름은?",
        "answer": "세종",
        "answer_data": {
            "grader_type": "exact",
            "correct": "세종",
            "trim": True,
        },
        "question_type": "short_answer",
        "difficulty": "easy",
        "subject": "역사",
    },
    {
        "content": "$\\sin^2 x + \\cos^2 x = ?$",
        "answer": "1",
        "answer_data": {
            "grader_type": "exact",
            "correct": "1",
            "trim": True,
        },
        "question_type": "short_answer",
        "difficulty": "easy",
        "subject": "수학",
        "tags": ["삼각함수"],
    },
    {
        "content": "이차함수 $y = x^2 - 4x + 3$의 꼭짓점 x좌표는?",
        "answer": "2",
        "answer_data": {
            "grader_type": "numeric",
            "value": 2,
            "tolerance": 0.001,
        },
        "question_type": "numeric",
        "difficulty": "medium",
        "subject": "수학",
        "tags": ["이차함수"],
    },
    {
        "content": "이차함수의 그래프 개형을 꼭짓점·축·대칭성 중심으로 설명하시오.",
        "answer_data": {
            "grader_type": "essay",
            "rubric": "꼭짓점·축·대칭성 3개 키워드를 모두 언급하면 만점, 1~2개는 부분점수.",
            "examples": [
                {
                    "answer": "꼭짓점에서 시작해서 좌우 대칭으로 올라가는 모양",
                    "score": 0.6,
                    "comment": "축 언급 없음 — 부분점수",
                },
                {
                    "answer": "꼭짓점을 정점으로 축에 대해 대칭인 곡선이 위/아래로 펼쳐짐",
                    "score": 1.0,
                    "comment": "3 키워드 모두 포함",
                },
            ],
        },
        "question_type": "essay",
        "difficulty": "medium",
        "subject": "수학",
        "tags": ["서술형"],
    },
    {
        "content": "민주주의의 핵심 원리 3가지를 설명하시오.",
        "answer_data": {
            "grader_type": "essay",
            "rubric": "국민주권·권력분립·법치주의(또는 동의어) 3가지를 모두 언급하면 만점.",
            "examples": [
                {
                    "answer": "국민이 주인이고 권력이 나뉘어 있고 법으로 다스림",
                    "score": 1.0,
                    "comment": "3 원리 모두 포함",
                },
            ],
        },
        "question_type": "essay",
        "difficulty": "medium",
        "subject": "사회",
        "tags": ["서술형"],
    },
    {
        "content": "햄릿의 작가는?",
        "answer": "셰익스피어",
        "answer_data": {
            "grader_type": "exact",
            "correct": "셰익스피어",
            "trim": True,
        },
        "question_type": "short_answer",
        "difficulty": "easy",
        "subject": "문학",
    },
    # ── 이미지 + 수식 결합 데모 ────────────────────────────────────────────
    {
        "content": (
            "다음 직각삼각형에서 $x$의 값은? (피타고라스 정리 활용)\n\n"
            "![직각삼각형 도형](/api/files/storage/courseware/demo-triangle.svg)"
        ),
        "answer": "5",
        "answer_data": {
            "grader_type": "numeric",
            "value": 5,
            "tolerance": 0.001,
        },
        "question_type": "numeric",
        "difficulty": "medium",
        "subject": "수학",
        "solution": "$x^2 = 3^2 + 4^2 = 25$, 따라서 $x = 5$.",
        "tags": ["피타고라스", "이미지"],
    },
    {
        "content": (
            "원점 $A(0, 0)$과 점 $B(7, 7)$을 지나는 직선의 기울기는?\n\n"
            "![좌표평면 위 직선](/api/files/storage/courseware/demo-line.svg)"
        ),
        "answer": "1",
        "answer_data": {
            "grader_type": "numeric",
            "value": 1,
            "tolerance": 0.001,
        },
        "question_type": "numeric",
        "difficulty": "easy",
        "subject": "수학",
        "solution": "기울기 $= \\dfrac{7-0}{7-0} = 1$.",
        "tags": ["일차함수", "이미지"],
    },
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.post("/_demo/seed")
async def seed_demo_courseware(
    request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """데모 코스웨어 데이터 일괄 생성.

    호출자의 첫 active 강좌에 Problem 10개 + ProblemSet 3개 + 학생 attempt를
    다양성 있게 생성. 멱등성을 위해 Problem.extra.demo=True 마크.

    응답: { course_id, course_name, problems_created, sets_created,
            attempts_created, skipped_reason? }
    """
    # 호출자가 가르치는(owner OR co_teacher) 첫 active 강좌, 없으면 admin은
    # 전체 활성 강좌 중 첫 번째
    owner_ids = (await db.execute(
        select(Course.id).where(
            Course.teacher_id == user.id,
            Course.is_active == True,  # noqa: E712
        ).order_by(Course.id.desc())
    )).scalars().all()
    co_ids = (await db.execute(
        select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
    )).scalars().all()
    cids = list(set(list(owner_ids) + list(co_ids)))
    if not cids:
        cids = (await db.execute(
            select(Course.id).where(Course.is_active == True).limit(1)  # noqa: E712
        )).scalars().all()
    if not cids:
        raise HTTPException(
            400,
            "활성 강좌가 없습니다. 먼저 강좌를 생성하세요 (마법사 또는 /classroom).",
        )
    course = await db.get(Course, cids[0])
    if not course:
        raise HTTPException(400, "강좌를 찾을 수 없습니다.")

    # 기존 demo Problem 확인 — tags(JSON)를 text로 cast 후 LIKE.
    existing_demo = (await db.execute(
        select(Problem).where(cast(Problem.tags, String).like('%"_demo_courseware"%'))
    )).scalars().all()

    problems_created = 0
    sets_created = 0
    attempts_created = 0

    if existing_demo:
        # 데모 Problem이 이미 있어도 이미지 파일이 누락됐을 수 있으니 멱등 확인.
        await _ensure_demo_images()
        return {
            "course_id": course.id,
            "course_name": course.name,
            "problems_created": 0,
            "sets_created": 0,
            "attempts_created": 0,
            "skipped_reason": f"이미 데모 Problem {len(existing_demo)}개 존재 — 멱등 skip",
        }

    # 0) 데모 SVG 이미지 storage에 작성
    await _ensure_demo_images()

    # 1) Problem 12개 생성
    created_problems: list[Problem] = []
    for pd in DEMO_PROBLEMS:
        tags = list(pd.get("tags", [])) + ["_demo_courseware"]
        p = Problem(
            department="math",
            subject=pd.get("subject", ""),
            difficulty=pd["difficulty"],
            question_type=pd["question_type"],
            content=pd["content"],
            solution=pd.get("solution"),
            answer=pd.get("answer"),
            answer_data=pd["answer_data"],
            tags=tags,
            is_visible=True,
            review_status="approved",
            created_by_id=user.id,
        )
        db.add(p)
        created_problems.append(p)
        problems_created += 1
    await db.flush()
    pids = [p.id for p in created_problems]

    # 2) ProblemSet 3개 (모두 published)
    now = _now()
    sets_defs = [
        {
            "title": "1단원 형성평가 (데모)",
            "description": "객관식·단답·수치 — 자동채점 즉시 결과",
            "problem_ids": pids[:5],
            "due_date": now + timedelta(days=7),
            "max_attempts": 3,
            "time_limit_seconds": 1800,
            "settings": {"shuffle_questions": True},
        },
        {
            "title": "2단원 종합 (데모)",
            "description": "마감 임박 — 학생 '오늘의 학습' 카드 추천 대상",
            "problem_ids": pids[5:8],
            "due_date": now + timedelta(hours=20),  # 24h 이내 → today_card 트리거
            "max_attempts": 2,
            "settings": {
                "llm_grader_enabled": True,
                "llm_grader_samples": 3,
            },
        },
        {
            "title": "3단원 기초 (데모)",
            "description": "마감 없음 — 새 문제 배지 트리거",
            "problem_ids": pids[8:],
            "due_date": None,
            "max_attempts": 5,
        },
    ]
    created_sets: list[CourseProblemSet] = []
    for sd in sets_defs:
        ps = CourseProblemSet(
            course_id=course.id,
            title=sd["title"],
            description=sd["description"],
            problem_ids=sd["problem_ids"],
            status="published",
            due_date=sd.get("due_date"),
            time_limit_seconds=sd.get("time_limit_seconds"),
            max_attempts=sd["max_attempts"],
            show_solution_after_due=True,
            settings=sd.get("settings"),
            created_by=user.id,
        )
        db.add(ps)
        created_sets.append(ps)
        sets_created += 1
    await db.flush()

    # 3) 학생 attempt 다양성 — active 수강생 활용
    students = (await db.execute(
        select(CourseStudent.student_id).where(
            CourseStudent.course_id == course.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()
    rng = random.Random(42)  # 재현 가능 시드

    if students:
        # 학생 비율: 80% 풀이 (1·2 세트), 50% 1단원만, 30% 3단원 (새 문제 미시도 유지)
        for ps_idx, ps in enumerate(created_sets):
            # 3단원(idx=2)은 학생 20%만 풀이 → '새 문제' 배지
            participation_rate = [1.0, 0.7, 0.2][ps_idx]
            participants = [
                sid for sid in students if rng.random() < participation_rate
            ]
            problems_in_set = [
                p for p in created_problems if p.id in ps.problem_ids
            ]
            for sid in participants:
                for p in problems_in_set:
                    grader = (p.answer_data or {}).get("grader_type", "")
                    is_auto = grader in ("choices", "exact", "regex", "numeric")
                    # 자동채점 대상: 70% 정답
                    if is_auto:
                        correct = rng.random() < 0.7
                        score = 1.0 if correct else 0.0
                        att = StudentProblemAttempt(
                            problem_set_id=ps.id,
                            problem_id=p.id,
                            student_id=sid,
                            attempt_number=1,
                            answer_data={
                                "selected": ["B"] if grader == "choices" and correct else ["A"],
                                "text": p.answer if correct else "오답",
                                "value": p.answer_data.get("value") if (correct and grader == "numeric") else 99,
                            },
                            is_correct=correct,
                            auto_score=score,
                            grading_status="none",
                            graded_at=_now(),
                        )
                    else:
                        # essay/manual — LLM 채점 결과 모의
                        roll = rng.random()
                        if roll < 0.6:
                            # 70% LLM done (정상 채점)
                            sc = round(rng.uniform(0.5, 1.0), 2)
                            att = StudentProblemAttempt(
                                problem_set_id=ps.id,
                                problem_id=p.id,
                                student_id=sid,
                                attempt_number=1,
                                answer_data={"text": "데모 학생 답안 — 핵심 키워드 일부 포함"},
                                is_correct=None,
                                auto_score=0.0,
                                manual_score=sc,
                                manual_feedback=f"(AI 채점) 데모 채점 결과 — {sc:.2f}점",
                                grading_status="done",
                                graded_at=_now(),
                                llm_metadata={
                                    "provider": "demo",
                                    "model": "demo-grader",
                                    "model_label": "데모 모델",
                                    "tokens_in": 320,
                                    "tokens_out": 80,
                                    "cost_usd": 0.0002,
                                    "samples": [{"score": sc, "feedback": "데모", "reasoning": "데모 reasoning"}],
                                    "score_mean": sc,
                                    "score_median": sc,
                                    "score_std": 0.05,
                                    "raw_response": "{\"reasoning\": \"...\", \"score\": " + str(sc) + ", \"feedback\": \"...\"}",
                                },
                            )
                        elif roll < 0.85:
                            # 25% needs_review (σ 큼)
                            samples = [
                                round(rng.uniform(0.3, 0.9), 2) for _ in range(3)
                            ]
                            mean = sum(samples) / len(samples)
                            samples.sort()
                            median = samples[1]
                            mx, mn = max(samples), min(samples)
                            std = round((mx - mn) / 2, 3)
                            att = StudentProblemAttempt(
                                problem_set_id=ps.id,
                                problem_id=p.id,
                                student_id=sid,
                                attempt_number=1,
                                answer_data={"text": "애매한 데모 답안 — 일부 맞고 일부 틀림"},
                                is_correct=None,
                                auto_score=0.0,
                                manual_score=median,
                                manual_feedback=f"(AI 채점) 신뢰도 낮음 — {median:.2f}점 (편차 큼)",
                                grading_status="needs_review",
                                graded_at=_now(),
                                llm_metadata={
                                    "provider": "demo",
                                    "model": "demo-grader",
                                    "model_label": "데모 모델",
                                    "tokens_in": 320 * 3,
                                    "tokens_out": 80 * 3,
                                    "cost_usd": 0.0006,
                                    "samples": [
                                        {"score": s, "feedback": "데모", "reasoning": f"데모 sample {i+1}"}
                                        for i, s in enumerate(samples)
                                    ],
                                    "score_mean": round(mean, 3),
                                    "score_median": median,
                                    "score_std": std,
                                    "raw_response": "데모 raw response (편차 큼)",
                                },
                            )
                        else:
                            # 15% failed
                            att = StudentProblemAttempt(
                                problem_set_id=ps.id,
                                problem_id=p.id,
                                student_id=sid,
                                attempt_number=1,
                                answer_data={"text": "데모 답안"},
                                is_correct=None,
                                auto_score=0.0,
                                grading_status="failed",
                                llm_metadata={
                                    "provider": "demo",
                                    "model": "demo-grader",
                                    "model_label": "데모 모델",
                                    "error": "데모 — API rate limit 모의 (재시도 권장)",
                                    "graded_at": _now().isoformat(),
                                },
                            )
                    db.add(att)
                    attempts_created += 1

    await db.flush()
    await log_action(
        db, user, "courseware.demo.seed",
        target=f"course:{course.id}",
        detail=f"problems:{problems_created} sets:{sets_created} attempts:{attempts_created}",
        is_sensitive=False,
        request=request,
    )
    return {
        "course_id": course.id,
        "course_name": course.name,
        "problems_created": problems_created,
        "sets_created": sets_created,
        "attempts_created": attempts_created,
        "student_count": len(students) if students else 0,
    }
