"""라이브 퀴즈 (Kahoot형) 라우터.

엔드포인트:
  호스트 (tools.quiz.host — 교사):
    GET  /api/tools/quiz/sessions               — 본인 host 세션 list
    POST /api/tools/quiz/sessions               — 세션 생성 (문제 세트 → PIN 발급, lobby)
    GET  /api/tools/quiz/sessions/{sid}         — host 상태 폴링 (2초)
    POST /api/tools/quiz/sessions/{sid}/start   — lobby → question(0)
    POST /api/tools/quiz/sessions/{sid}/reveal  — question → reveal
    POST /api/tools/quiz/sessions/{sid}/next    — reveal → question(+1) | ended
    POST /api/tools/quiz/sessions/{sid}/end     — 즉시 종료
    GET  /api/tools/quiz/sessions/{sid}/qr.png  — 입장 QR (FRONTEND_URL/s/quiz/{pin})

  플레이어 (인증만 — 권한 키 없음):
    POST /api/tools/quiz/join                   — {pin} → 입장 (player upsert)
    GET  /api/tools/quiz/play/{sid}/state       — 플레이어 상태 폴링 (2초)
    POST /api/tools/quiz/play/{sid}/answer      — 현재 문제 답안 제출 (1회)

점수 (Kahoot식): 정답 시 1000 × (1 - (t/limit)/2), t=답변까지 초 (limit 상한).
채점은 services/courseware_grader.grade_answer 재사용 (자동채점 가능 문제만 출제).
진행 동기화는 폴링 — 60명 부하 검증 수준. WS는 v2.
"""

from __future__ import annotations

import asyncio
import io
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import Text as SaText, cast, func as sa_func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.models import (
    Course, CoursePost, CourseProblemSet, CourseStudent,
    LiveQuizAnswer, LiveQuizPlayer, LiveQuizSession, Problem, User,
)
from app.modules.classroom.teachers import is_course_editor_or_admin
from app.modules.tool_quiz.schemas import (
    QuizAnswerReq, QuizJoinReq, QuizSessionCreate,
)
from app.services.courseware_grader import AUTO_GRADER_TYPES, grade_answer

router = APIRouter(prefix="/api/tools/quiz", tags=["tool-quiz"])

DEFAULT_TIME_PER_QUESTION = 30  # 초
ANSWER_GRACE_MS = 2_000         # 네트워크 지연 보정
MAX_PLAYERS = 300


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _time_limit(s: LiveQuizSession) -> int:
    try:
        v = int((s.settings or {}).get("time_per_question") or DEFAULT_TIME_PER_QUESTION)
    except (TypeError, ValueError):
        v = DEFAULT_TIME_PER_QUESTION
    return max(5, min(600, v))


async def _get_session_or_404(db: AsyncSession, sid: int) -> LiveQuizSession:
    s = await db.get(LiveQuizSession, sid)
    if not s:
        raise HTTPException(404, "세션 없음")
    return s


def _assert_host(s: LiveQuizSession, user: User) -> None:
    if s.host_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인이 만든 세션만 진행 가능")


async def _gen_pin(db: AsyncSession) -> str:
    """6자리 숫자 PIN — 진행 중(미종료) 세션과 충돌 없게."""
    for _ in range(30):
        pin = str(secrets.randbelow(1_000_000)).zfill(6)
        dup = (await db.execute(
            select(LiveQuizSession.id).where(
                LiveQuizSession.pin == pin,
                LiveQuizSession.status != "ended",
            ).limit(1)
        )).scalar_one_or_none()
        if dup is None:
            return pin
    raise HTTPException(503, "PIN 발급 실패 — 잠시 후 다시 시도")


async def _load_problems(db: AsyncSession, ids: list[int]) -> list[Problem]:
    if not ids:
        return []
    rows = (await db.execute(select(Problem).where(Problem.id.in_(ids)))).scalars().all()
    by_id = {p.id: p for p in rows}
    return [by_id[i] for i in ids if i in by_id]


async def _current_problem(db: AsyncSession, s: LiveQuizSession) -> Problem | None:
    ids = s.problem_ids or []
    if not (0 <= s.current_index < len(ids)):
        return None
    return await db.get(Problem, ids[s.current_index])


def _problem_public(p: Problem) -> dict:
    """플레이어용 — 정답 마스킹, 보기만."""
    out = {
        "id": p.id,
        "type": p.question_type,
        "content": p.content,
    }
    if p.answer_data and isinstance(p.answer_data, dict):
        choices = p.answer_data.get("choices")
        if choices:
            out["choices"] = choices
    return out


def _problem_full(p: Problem) -> dict:
    """호스트용 — 정답 포함."""
    out = _problem_public(p)
    out["answer"] = p.answer
    out["solution"] = p.solution
    if p.answer_data and isinstance(p.answer_data, dict):
        out["correct"] = p.answer_data.get("correct")
        out["grader_type"] = p.answer_data.get("grader_type")
    return out


def _correct_display(p: Problem) -> str | None:
    """reveal 화면 정답 표시 텍스트."""
    if p.answer:
        return p.answer
    ad = p.answer_data or {}
    if not isinstance(ad, dict):
        return None
    g = (ad.get("grader_type") or "").lower()
    if g == "choices":
        c = ad.get("correct")
        return ", ".join(c) if isinstance(c, list) else (str(c) if c else None)
    if g in ("exact", "regex"):
        return str(ad.get("correct") or ad.get("pattern") or "")
    if g == "numeric":
        v = ad.get("value")
        return str(v) if v is not None else None
    return None


async def _players_sorted(db: AsyncSession, sid: int) -> list[LiveQuizPlayer]:
    return list((await db.execute(
        select(LiveQuizPlayer).where(LiveQuizPlayer.session_id == sid)
        .order_by(LiveQuizPlayer.score.desc(), LiveQuizPlayer.joined_at.asc())
    )).scalars().all())


def _leaderboard(players: list[LiveQuizPlayer], top: int) -> list[dict]:
    return [
        {"rank": i + 1, "nickname": pl.nickname, "score": round(pl.score)}
        for i, pl in enumerate(players[:top])
    ]


def _join_url(pin: str) -> str:
    return f"{app_settings.FRONTEND_URL}/s/quiz/{pin}"


async def _attached_in_user_courses(
    db: AsyncSession, user: User, quiz_id: int,
) -> bool:
    """이 퀴즈가 사용자 소속 강좌(수강생/owner/공동교사) 글에 첨부됐는지.

    info 엔드포인트의 PIN 노출 범위 — sid 열거로 타 수업 PIN을 얻는 것 차단.
    (attachment_share 패턴: JSON→text LIKE prefilter + Python 매칭)
    """
    from app.models import CourseTeacher

    student_ids = (await db.execute(
        select(CourseStudent.course_id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()
    owner_ids = (await db.execute(
        select(Course.id).where(Course.teacher_id == user.id)
    )).scalars().all()
    co_ids = (await db.execute(
        select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
    )).scalars().all()
    course_ids = set(student_ids) | set(owner_ids) | set(co_ids)
    if not course_ids:
        return False
    rows = (await db.execute(
        select(CoursePost.attachments).where(
            CoursePost.course_id.in_(course_ids),
            CoursePost.attachments.isnot(None),
            cast(CoursePost.attachments, SaText).like('%"live_quiz_id"%'),
        )
    )).scalars().all()
    for atts in rows:
        if not isinstance(atts, list):
            continue
        for a in atts:
            if (
                isinstance(a, dict)
                and a.get("type") == "live_quiz"
                and a.get("live_quiz_id") == quiz_id
            ):
                return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# 호스트
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/sessions")
async def my_sessions(
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 host인 세션 최근 30개."""
    rows = (await db.execute(
        select(LiveQuizSession).where(LiveQuizSession.host_id == user.id)
        .order_by(LiveQuizSession.created_at.desc()).limit(30)
    )).scalars().all()
    # 참가자 수 일괄
    sids = [s.id for s in rows]
    counts: dict[int, int] = {}
    if sids:
        cnt_rows = (await db.execute(
            select(LiveQuizPlayer.session_id, sa_func.count(LiveQuizPlayer.id))
            .where(LiveQuizPlayer.session_id.in_(sids))
            .group_by(LiveQuizPlayer.session_id)
        )).all()
        counts = {r[0]: r[1] for r in cnt_rows}
    return {
        "items": [
            {
                "id": s.id,
                "title": s.title,
                "pin": s.pin,
                "status": s.status,
                "problem_count": len(s.problem_ids or []),
                "player_count": counts.get(s.id, 0),
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            }
            for s in rows
        ]
    }


@router.post("/sessions")
async def create_session(
    body: QuizSessionCreate, request: Request,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    """문제 세트로 세션 생성 — 자동채점 가능 문제만 snapshot."""
    ps = await db.get(CourseProblemSet, body.problem_set_id)
    if not ps or ps.deleted_at is not None:
        raise HTTPException(404, "문제 세트 없음")
    course = await db.get(Course, ps.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "본인 강좌의 문제 세트만 사용 가능")

    problems = await _load_problems(db, list(ps.problem_ids or []))
    quiz_ids = [
        p.id for p in problems
        if isinstance(p.answer_data, dict)
        and (p.answer_data.get("grader_type") or "").lower() in AUTO_GRADER_TYPES
    ]
    if not quiz_ids:
        raise HTTPException(400, "자동채점 가능한 문제가 없습니다 (객관식·단답·수치만 지원)")

    merged_settings = {"time_per_question": DEFAULT_TIME_PER_QUESTION}
    if body.settings and isinstance(body.settings, dict):
        merged_settings.update(body.settings)

    s = LiveQuizSession(
        problem_set_id=ps.id,
        host_id=user.id,
        title=ps.title,
        pin=await _gen_pin(db),
        status="lobby",
        current_index=0,
        problem_ids=quiz_ids,
        settings=merged_settings,
    )
    db.add(s)
    await db.flush()

    await log_action(
        db, user, "tools.quiz.session_create",
        target=f"quiz:{s.id} set:{ps.id} problems:{len(quiz_ids)}",
        request=request,
    )
    return {
        "id": s.id, "pin": s.pin, "title": s.title,
        "problem_count": len(quiz_ids), "join_url": _join_url(s.pin),
        "skipped_problems": len(problems) - len(quiz_ids),
    }


@router.get("/sessions/{sid}")
async def host_state(
    sid: int,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    """호스트 진행 화면 폴링 (2초)."""
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)

    players = await _players_sorted(db, sid)
    total = len(s.problem_ids or [])
    out: dict = {
        "id": s.id,
        "title": s.title,
        "pin": s.pin,
        "join_url": _join_url(s.pin),
        "status": s.status,
        "current_index": s.current_index,
        "total": total,
        "time_limit": _time_limit(s),
        "question_started_at": s.question_started_at.isoformat() if s.question_started_at else None,
        "server_now": _now().isoformat(),
        "player_count": len(players),
        "players": [
            {"id": pl.id, "nickname": pl.nickname, "score": round(pl.score)}
            for pl in players[:MAX_PLAYERS]
        ],
    }

    if s.status in ("question", "reveal"):
        p = await _current_problem(db, s)
        if p:
            out["current_problem"] = _problem_full(p)
            ans_rows = (await db.execute(
                select(LiveQuizAnswer).where(
                    LiveQuizAnswer.session_id == sid,
                    LiveQuizAnswer.problem_id == p.id,
                )
            )).scalars().all()
            out["answered_count"] = len(ans_rows)
            if s.status == "reveal":
                out["correct_display"] = _correct_display(p)
                out["correct_count"] = sum(1 for a in ans_rows if a.is_correct)
                # 객관식 분포
                dist: dict[str, int] = {}
                for a in ans_rows:
                    sel = (a.answer or {}).get("selected") if isinstance(a.answer, dict) else None
                    if isinstance(sel, list):
                        for k in sel:
                            dist[str(k)] = dist.get(str(k), 0) + 1
                out["distribution"] = dist
                out["leaderboard"] = _leaderboard(players, 10)

    if s.status == "ended":
        out["leaderboard"] = _leaderboard(players, MAX_PLAYERS)

    return out


async def _transition(
    db: AsyncSession, request: Request, user: User, sid: int,
    *, expect: tuple[str, ...], action: str,
) -> LiveQuizSession:
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)
    if s.status not in expect:
        raise HTTPException(409, f"현재 상태({s.status})에서는 불가")
    await log_action(db, user, f"tools.quiz.{action}", target=f"quiz:{sid}", request=request)
    return s


@router.post("/sessions/{sid}/start")
async def start_session(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _transition(db, request, user, sid, expect=("lobby",), action="start")
    if not (s.problem_ids or []):
        raise HTTPException(400, "출제할 문제가 없습니다")
    s.status = "question"
    s.current_index = 0
    s.question_started_at = _now()
    await db.flush()
    return {"ok": True, "status": s.status, "current_index": s.current_index}


@router.post("/sessions/{sid}/reveal")
async def reveal_question(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _transition(db, request, user, sid, expect=("question",), action="reveal")
    s.status = "reveal"
    await db.flush()
    return {"ok": True, "status": s.status}


@router.post("/sessions/{sid}/next")
async def next_question(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _transition(db, request, user, sid, expect=("reveal",), action="next")
    total = len(s.problem_ids or [])
    if s.current_index + 1 >= total:
        s.status = "ended"
        s.ended_at = _now()
    else:
        s.current_index += 1
        s.status = "question"
        s.question_started_at = _now()
    await db.flush()
    return {"ok": True, "status": s.status, "current_index": s.current_index}


@router.post("/sessions/{sid}/end")
async def end_session(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _transition(
        db, request, user, sid,
        expect=("lobby", "question", "reveal"), action="end",
    )
    s.status = "ended"
    s.ended_at = _now()
    await db.flush()
    return {"ok": True, "status": s.status}


@router.get("/sessions/{sid}/qr.png")
async def session_qr(
    sid: int,
    user: User = Depends(require_permission("tools.quiz.host")),
    db: AsyncSession = Depends(get_db),
):
    """입장 URL QR PNG — 로비 화면 표시용."""
    import qrcode  # lazy — classroom_links와 동일 의존성

    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)
    url = _join_url(s.pin)

    def _render() -> bytes:
        img = qrcode.make(url)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    png = await asyncio.to_thread(_render)
    return StreamingResponse(
        iter([png]), media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="quiz_{s.pin}.png"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 플레이어
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/info/{sid}")
async def session_info(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """클래스룸 첨부 클릭용 — 세션 요약.

    PIN 노출 범위: host/admin 또는 이 퀴즈가 첨부된 강좌의 멤버만.
    (sid 열거로 타 수업 PIN을 얻는 것 차단 — 구두 공유 PIN 입장은 /s/quiz 직접 입력)
    종료된 세션은 pin 미노출.
    """
    s = await _get_session_or_404(db, sid)
    is_host = s.host_id == user.id or is_admin(user)
    can_see_pin = s.status != "ended" and (
        is_host or await _attached_in_user_courses(db, user, s.id)
    )
    return {
        "id": s.id,
        "title": s.title,
        "status": s.status,
        "pin": s.pin if can_see_pin else None,
        "is_host": is_host,
    }


@router.post("/join")
async def join_session(
    body: QuizJoinReq,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PIN으로 입장 — 진행 중(미종료) 최신 세션. 이미 입장했으면 그대로 반환."""
    pin = body.pin.strip()
    s = (await db.execute(
        select(LiveQuizSession).where(
            LiveQuizSession.pin == pin,
            LiveQuizSession.status != "ended",
        ).order_by(LiveQuizSession.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "해당 PIN의 진행 중인 퀴즈가 없습니다")

    pl = (await db.execute(
        select(LiveQuizPlayer).where(
            LiveQuizPlayer.session_id == s.id,
            LiveQuizPlayer.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not pl:
        cnt = (await db.execute(
            select(sa_func.count(LiveQuizPlayer.id))
            .where(LiveQuizPlayer.session_id == s.id)
        )).scalar_one()
        if cnt >= MAX_PLAYERS:
            raise HTTPException(409, "참가 인원이 가득 찼습니다")
        pl = LiveQuizPlayer(
            session_id=s.id, user_id=user.id,
            nickname=(user.name or f"#{user.id}")[:50],
        )
        db.add(pl)
        await db.flush()

    return {
        "session_id": s.id, "player_id": pl.id,
        "title": s.title, "status": s.status,
    }


async def _get_player_or_403(
    db: AsyncSession, sid: int, user: User,
) -> LiveQuizPlayer:
    pl = (await db.execute(
        select(LiveQuizPlayer).where(
            LiveQuizPlayer.session_id == sid,
            LiveQuizPlayer.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not pl:
        raise HTTPException(403, "먼저 PIN으로 입장하세요")
    return pl


@router.get("/play/{sid}/state")
async def player_state(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """플레이어 화면 폴링 (2초)."""
    s = await _get_session_or_404(db, sid)
    pl = await _get_player_or_403(db, sid, user)

    players = await _players_sorted(db, sid)
    my_rank = next((i + 1 for i, x in enumerate(players) if x.id == pl.id), None)
    total = len(s.problem_ids or [])

    out: dict = {
        "id": s.id,
        "title": s.title,
        "status": s.status,
        "current_index": s.current_index,
        "total": total,
        "time_limit": _time_limit(s),
        "question_started_at": s.question_started_at.isoformat() if s.question_started_at else None,
        "server_now": _now().isoformat(),
        "player_count": len(players),
        "me": {
            "player_id": pl.id,
            "nickname": pl.nickname,
            "score": round(pl.score),
            "rank": my_rank,
        },
    }

    if s.status in ("question", "reveal"):
        p = await _current_problem(db, s)
        if p:
            out["question"] = _problem_public(p)
            my_ans = (await db.execute(
                select(LiveQuizAnswer).where(
                    LiveQuizAnswer.session_id == sid,
                    LiveQuizAnswer.player_id == pl.id,
                    LiveQuizAnswer.problem_id == p.id,
                )
            )).scalar_one_or_none()
            out["my_answered"] = my_ans is not None
            if s.status == "reveal":
                out["correct_display"] = _correct_display(p)
                out["my_result"] = {
                    "is_correct": my_ans.is_correct,
                    "points": round(my_ans.points),
                    "answer": my_ans.answer,
                } if my_ans else None
                out["leaderboard"] = _leaderboard(players, 5)

    if s.status == "ended":
        out["leaderboard"] = _leaderboard(players, 10)

    return out


@router.post("/play/{sid}/answer")
async def submit_answer(
    sid: int, body: QuizAnswerReq,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 문제 답안 제출 — 문제당 1회, 제한 시간 내."""
    s = await _get_session_or_404(db, sid)
    if s.status != "question":
        raise HTTPException(409, "지금은 답안을 받을 수 없습니다")
    pl = await _get_player_or_403(db, sid, user)

    p = await _current_problem(db, s)
    if not p:
        raise HTTPException(409, "현재 출제 중인 문제가 없습니다")

    # 시간 판정 (서버 기준)
    if not s.question_started_at:
        raise HTTPException(409, "문제가 아직 시작되지 않았습니다")
    started = s.question_started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed_ms = int((_now() - started).total_seconds() * 1000)
    limit_ms = _time_limit(s) * 1000
    if elapsed_ms > limit_ms + ANSWER_GRACE_MS:
        raise HTTPException(409, "시간 초과")

    # 중복 제출 차단
    dup = (await db.execute(
        select(LiveQuizAnswer.id).where(
            LiveQuizAnswer.session_id == sid,
            LiveQuizAnswer.player_id == pl.id,
            LiveQuizAnswer.problem_id == p.id,
        ).limit(1)
    )).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(409, "이미 제출했습니다")

    is_correct, _score = grade_answer(p.answer_data, body.answer)

    # Kahoot식 점수: 1000 × (1 - (t/limit)/2) — t는 limit 상한
    points = 0.0
    if is_correct:
        t = min(elapsed_ms, limit_ms) / limit_ms  # 0.0 ~ 1.0
        points = 1000.0 * (1.0 - t / 2.0)

    ans = LiveQuizAnswer(
        session_id=sid,
        player_id=pl.id,
        problem_id=p.id,
        answer=body.answer,
        is_correct=is_correct,
        ms_taken=elapsed_ms,
        points=points,
    )
    db.add(ans)
    pl.score = (pl.score or 0.0) + points
    try:
        await db.flush()
    except IntegrityError:
        # 동시 더블클릭 — pre-check를 둘 다 통과한 경우 UNIQUE가 잡음.
        # (get_db가 transaction rollback — score 증가도 함께 원복됨)
        raise HTTPException(409, "이미 제출했습니다")

    return {
        "ok": True,
        "is_correct": is_correct,
        "points": round(points),
        "total_score": round(pl.score),
    }
