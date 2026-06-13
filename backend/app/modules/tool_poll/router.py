"""실시간 투표·워드클라우드 (Mentimeter형) 라우터.

엔드포인트:
  호스트 (tools.poll.host — 교사):
    GET  /api/tools/poll                       — 본인 투표 list (휴지통 제외)
    POST /api/tools/poll                       — 투표 생성 (질문 묶음)
    GET  /api/tools/poll/sessions              — 본인 host 세션 list
    GET  /api/tools/poll/sessions/{sid}        — host 상태 폴링 (2초, 실시간 집계 포함)
    POST /api/tools/poll/sessions/{sid}/start  — lobby → question(0)
    POST /api/tools/poll/sessions/{sid}/goto   — 질문 자유 이동 (Mentimeter 슬라이드식)
    POST /api/tools/poll/sessions/{sid}/end    — 종료
    GET  /api/tools/poll/sessions/{sid}/qr.png — 입장 QR (FRONTEND_URL/s/poll/{pin})
    GET  /api/tools/poll/{pid}                 — 투표 상세
    PUT  /api/tools/poll/{pid}                 — 수정 (진행 중 세션은 snapshot이라 무관)
    DELETE /api/tools/poll/{pid}               — 드라이브 휴지통 이동 (soft delete)
    POST /api/tools/poll/{pid}/sessions        — 세션 생성 (질문 snapshot → PIN 발급)

  참여자 (인증만 — 권한 키 없음):
    POST /api/tools/poll/join                  — {pin} → 입장 (participant upsert)
    GET  /api/tools/poll/play/{sid}/state      — 참여자 상태 폴링 (2초)
    POST /api/tools/poll/play/{sid}/respond    — 현재 질문 응답

응답은 익명 집계로만 노출 (개인별 응답은 어디에도 표시 안 함 — Mentimeter 동일).
점수·타이머 없음. 진행 동기화는 2초 폴링 (퀴즈와 동일 — WS는 v2).

⚠️ 라우트 순서: "/sessions..."·"/join"·"/play..." literal 경로를 "/{pid}"보다
먼저 등록 (FastAPI path param은 [^/]+ — 뒤에 등록한 literal은 먹힘).
"""

from __future__ import annotations

import asyncio
import io
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func as sa_func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.models import (
    Poll, PollParticipant, PollResponse, PollSession, User,
)
from app.modules.tool_poll.schemas import (
    PollCreate, PollGotoReq, PollJoinReq, PollQuestionIn,
    PollRespondReq, PollSessionCreate, PollUpdate,
)

router = APIRouter(prefix="/api/tools/poll", tags=["tool-poll"])

MAX_PARTICIPANTS = 300
MAX_OPTIONS = 10
WORD_MAX_LEN = 30
TOP_WORDS = 100


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_questions(qs: list[PollQuestionIn]) -> list[dict]:
    """질문 검증 + stable id 부여. 응답(question_id)이 id를 참조하므로 유일 보장."""
    out: list[dict] = []
    used: set[str] = set()
    for i, q in enumerate(qs):
        qid = (q.id or "").strip() or f"q{secrets.token_urlsafe(4)}"
        base, n = qid, 1
        while qid in used:
            n += 1
            qid = f"{base}_{n}"
        used.add(qid)
        prompt = q.prompt.strip()
        if not prompt:
            raise HTTPException(400, f"{i + 1}번 질문: 내용을 입력하세요")
        if q.type == "choice":
            options = [o.strip()[:200] for o in q.options if o.strip()][:MAX_OPTIONS]
            if len(options) < 2:
                raise HTTPException(400, f"{i + 1}번 질문: 보기는 2개 이상 필요합니다")
            out.append({
                "id": qid, "type": "choice", "prompt": prompt,
                "options": options, "multi": bool(q.multi),
            })
        else:
            out.append({
                "id": qid, "type": "wordcloud", "prompt": prompt,
                "max_words": max(1, min(5, q.max_words)),
            })
    return out


def _norm_word(raw: str) -> str:
    """워드클라우드 단어 정규화 — 같은 단어가 표기 차이로 흩어지지 않게.

    공백 정리 + 앞뒤 구두점 제거 + ASCII만 소문자화 (한글 무영향) + 30자 제한.
    """
    w = " ".join(raw.split())
    w = w.strip(".,!?;:'\"()[]{}~-_·…“”‘’")
    return w.lower()[:WORD_MAX_LEN]


async def _get_poll_or_404(db: AsyncSession, pid: int) -> Poll:
    p = await db.get(Poll, pid)
    if not p or p.deleted_at is not None:
        raise HTTPException(404, "투표 없음")
    return p


def _assert_owner(p: Poll, user: User) -> None:
    if p.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인이 만든 투표만 가능")


async def _get_session_or_404(db: AsyncSession, sid: int) -> PollSession:
    s = await db.get(PollSession, sid)
    if not s:
        raise HTTPException(404, "세션 없음")
    return s


def _assert_host(s: PollSession, user: User) -> None:
    if s.host_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인이 만든 세션만 진행 가능")


async def _gen_pin(db: AsyncSession) -> str:
    """6자리 숫자 PIN — 진행 중(미종료) 투표 세션과 충돌 없게."""
    for _ in range(30):
        pin = str(secrets.randbelow(1_000_000)).zfill(6)
        dup = (await db.execute(
            select(PollSession.id).where(
                PollSession.pin == pin,
                PollSession.status != "ended",
            ).limit(1)
        )).scalar_one_or_none()
        if dup is None:
            return pin
    raise HTTPException(503, "PIN 발급 실패 — 잠시 후 다시 시도")


def _join_url(pin: str) -> str:
    return f"{app_settings.FRONTEND_URL}/s/poll/{pin}"


def _question_at(s: PollSession, index: int) -> dict | None:
    qs = s.questions or []
    if not (0 <= index < len(qs)):
        return None
    q = qs[index]
    return q if isinstance(q, dict) else None


def _results_to_students(s: PollSession) -> bool:
    return bool((s.settings or {}).get("results_to_students"))


async def _load_responses(
    db: AsyncSession, sid: int, question_id: str,
) -> list[PollResponse]:
    return list((await db.execute(
        select(PollResponse).where(
            PollResponse.session_id == sid,
            PollResponse.question_id == question_id,
        )
    )).scalars().all())


def _aggregate(question: dict, responses: list[PollResponse]) -> dict:
    """익명 집계 — choice는 보기별 카운트, wordcloud는 단어 빈도 top 100."""
    respondents = len({r.participant_id for r in responses})
    if question.get("type") == "choice":
        counts: dict[str, int] = {}
        for r in responses:
            sel = (r.answer or {}).get("selected") if isinstance(r.answer, dict) else None
            if isinstance(sel, list):
                for k in sel:
                    counts[str(k)] = counts.get(str(k), 0) + 1
        return {"type": "choice", "counts": counts, "respondents": respondents}
    freq: dict[str, int] = {}
    for r in responses:
        w = (r.answer or {}).get("word") if isinstance(r.answer, dict) else None
        if isinstance(w, str):
            key = _norm_word(w)
            if key:
                freq[key] = freq.get(key, 0) + 1
    top = sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_WORDS]
    return {
        "type": "wordcloud",
        "words": [{"text": t, "count": c} for t, c in top],
        "respondents": respondents,
    }


def _poll_dict(p: Poll, *, active_pins: dict[int, str] | None = None) -> dict:
    """⚠️ p를 수정(flush)한 직후라면 호출 전 db.refresh(p) 필수 —
    updated_at이 onupdate=func.now()라 expired 상태에서 isoformat이 MissingGreenlet."""
    return {
        "id": p.id,
        "title": p.title,
        "description": p.description,
        "questions": p.questions or [],
        "question_count": len(p.questions or []),
        "active_pin": (active_pins or {}).get(p.id),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 호스트 — 투표 CRUD (literal 경로인 /sessions·/join·/play 먼저 등록)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
async def my_polls(
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """본인 투표 list (휴지통 제외) + 진행 중 세션 PIN."""
    rows = (await db.execute(
        select(Poll).where(
            Poll.owner_id == user.id,
            Poll.deleted_at.is_(None),
        ).order_by(Poll.updated_at.desc()).limit(100)
    )).scalars().all()
    pids = [p.id for p in rows]
    active_pins: dict[int, str] = {}
    if pids:
        sess = (await db.execute(
            select(PollSession.poll_id, PollSession.pin).where(
                PollSession.poll_id.in_(pids),
                PollSession.status != "ended",
            ).order_by(PollSession.created_at.asc())
        )).all()
        for poll_id, pin in sess:
            if poll_id is not None:
                active_pins[poll_id] = pin  # 최신 세션이 덮음
    return {"items": [_poll_dict(p, active_pins=active_pins) for p in rows]}


@router.post("")
async def create_poll(
    body: PollCreate, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    questions = _normalize_questions(body.questions)
    p = Poll(
        owner_id=user.id,
        title=body.title.strip(),
        description=(body.description or "").strip() or None,
        questions=questions,
    )
    db.add(p)
    await db.flush()
    await db.refresh(p)  # updated_at server_default — isoformat 접근 대비
    await log_action(
        db, user, "tools.poll.create",
        target=f"poll:{p.id} questions:{len(questions)}", request=request,
    )
    return _poll_dict(p)


# ── 세션 (literal — /{pid}보다 먼저) ─────────────────────────────────────────

@router.get("/sessions")
async def my_sessions(
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 host인 세션 최근 30개."""
    rows = (await db.execute(
        select(PollSession).where(PollSession.host_id == user.id)
        .order_by(PollSession.created_at.desc()).limit(30)
    )).scalars().all()
    sids = [s.id for s in rows]
    counts: dict[int, int] = {}
    if sids:
        cnt_rows = (await db.execute(
            select(PollParticipant.session_id, sa_func.count(PollParticipant.id))
            .where(PollParticipant.session_id.in_(sids))
            .group_by(PollParticipant.session_id)
        )).all()
        counts = {r[0]: r[1] for r in cnt_rows}
    return {
        "items": [
            {
                "id": s.id,
                "title": s.title,
                "pin": s.pin,
                "status": s.status,
                "question_count": len(s.questions or []),
                "participant_count": counts.get(s.id, 0),
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            }
            for s in rows
        ]
    }


@router.get("/sessions/{sid}")
async def host_state(
    sid: int,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """호스트 진행 화면 폴링 (2초) — 현재 질문 + 실시간 집계."""
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)

    participant_count = (await db.execute(
        select(sa_func.count(PollParticipant.id))
        .where(PollParticipant.session_id == sid)
    )).scalar_one()

    total = len(s.questions or [])
    out: dict = {
        "id": s.id,
        "title": s.title,
        "pin": s.pin,
        "join_url": _join_url(s.pin),
        "status": s.status,
        "current_index": s.current_index,
        "total": total,
        "participant_count": participant_count,
        "results_to_students": _results_to_students(s),
        "server_now": _now().isoformat(),
    }

    if s.status == "question":
        q = _question_at(s, s.current_index)
        if q:
            responses = await _load_responses(db, sid, str(q.get("id")))
            out["current_question"] = q
            out["results"] = _aggregate(q, responses)

    if s.status == "ended":
        all_results = []
        for q in (s.questions or []):
            if not isinstance(q, dict):
                continue
            responses = await _load_responses(db, sid, str(q.get("id")))
            all_results.append({"question": q, "results": _aggregate(q, responses)})
        out["all_results"] = all_results

    return out


@router.post("/sessions/{sid}/start")
async def start_session(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)
    if s.status != "lobby":
        raise HTTPException(409, f"현재 상태({s.status})에서는 불가")
    if not (s.questions or []):
        raise HTTPException(400, "질문이 없습니다")
    s.status = "question"
    s.current_index = 0
    await db.flush()
    await log_action(db, user, "tools.poll.start", target=f"poll_session:{sid}", request=request)
    return {"ok": True, "status": s.status, "current_index": s.current_index}


@router.post("/sessions/{sid}/goto")
async def goto_question(
    sid: int, body: PollGotoReq,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """질문 자유 이동 (Mentimeter 슬라이드식 — 앞뒤 어디로든)."""
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)
    if s.status != "question":
        raise HTTPException(409, f"현재 상태({s.status})에서는 불가")
    total = len(s.questions or [])
    if not (0 <= body.index < total):
        raise HTTPException(400, "질문 번호 범위 밖")
    s.current_index = body.index
    await db.flush()
    return {"ok": True, "current_index": s.current_index}


@router.post("/sessions/{sid}/end")
async def end_session(
    sid: int, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_session_or_404(db, sid)
    _assert_host(s, user)
    if s.status == "ended":
        raise HTTPException(409, "이미 종료된 세션")
    s.status = "ended"
    s.ended_at = _now()
    await db.flush()
    await log_action(db, user, "tools.poll.end", target=f"poll_session:{sid}", request=request)
    return {"ok": True, "status": s.status}


@router.get("/sessions/{sid}/qr.png")
async def session_qr(
    sid: int,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """입장 URL QR PNG — 호스트 화면 표시용."""
    import qrcode  # lazy — tool_quiz와 동일 의존성

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
        headers={"Content-Disposition": f'inline; filename="poll_{s.pin}.png"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 참여자 (인증만)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/join")
async def join_session(
    body: PollJoinReq,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """PIN으로 입장 — 진행 중(미종료) 최신 세션. 이미 입장했으면 그대로 반환."""
    pin = body.pin.strip()
    s = (await db.execute(
        select(PollSession).where(
            PollSession.pin == pin,
            PollSession.status != "ended",
        ).order_by(PollSession.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "해당 PIN의 진행 중인 투표가 없습니다")

    pt = (await db.execute(
        select(PollParticipant).where(
            PollParticipant.session_id == s.id,
            PollParticipant.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not pt:
        cnt = (await db.execute(
            select(sa_func.count(PollParticipant.id))
            .where(PollParticipant.session_id == s.id)
        )).scalar_one()
        if cnt >= MAX_PARTICIPANTS:
            raise HTTPException(409, "참가 인원이 가득 찼습니다")
        pt = PollParticipant(
            session_id=s.id, user_id=user.id,
            nickname=(user.name or f"#{user.id}")[:50],
        )
        db.add(pt)
        try:
            await db.flush()
        except IntegrityError:
            # 동시 입장 race — UNIQUE가 잡으면 기존 row 재조회
            raise HTTPException(409, "다시 시도하세요")

    return {
        "session_id": s.id, "participant_id": pt.id,
        "title": s.title, "status": s.status,
    }


async def _get_participant_or_403(
    db: AsyncSession, sid: int, user: User,
) -> PollParticipant:
    pt = (await db.execute(
        select(PollParticipant).where(
            PollParticipant.session_id == sid,
            PollParticipant.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not pt:
        raise HTTPException(403, "먼저 PIN으로 입장하세요")
    return pt


@router.get("/play/{sid}/state")
async def participant_state(
    sid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """참여자 화면 폴링 (2초)."""
    s = await _get_session_or_404(db, sid)
    pt = await _get_participant_or_403(db, sid, user)

    total = len(s.questions or [])
    out: dict = {
        "id": s.id,
        "title": s.title,
        "status": s.status,
        "current_index": s.current_index,
        "total": total,
        "results_to_students": _results_to_students(s),
        "server_now": _now().isoformat(),
    }

    if s.status == "question":
        q = _question_at(s, s.current_index)
        if q:
            qid = str(q.get("id"))
            out["question"] = q
            mine = (await db.execute(
                select(PollResponse).where(
                    PollResponse.session_id == sid,
                    PollResponse.participant_id == pt.id,
                    PollResponse.question_id == qid,
                ).order_by(PollResponse.answer_no.asc())
            )).scalars().all()
            if q.get("type") == "wordcloud":
                my_words = [
                    (r.answer or {}).get("word")
                    for r in mine
                    if isinstance(r.answer, dict)
                ]
                out["my_words"] = [w for w in my_words if isinstance(w, str)]
                out["my_remaining"] = max(
                    0, int(q.get("max_words") or 1) - len(mine),
                )
                out["my_responded"] = len(mine) > 0
            else:
                out["my_responded"] = len(mine) > 0
                if mine:
                    sel = (mine[0].answer or {}).get("selected")
                    out["my_selected"] = sel if isinstance(sel, list) else []
            # 집계는 results_to_students=true + 본인 응답 후에만 (응답 유도)
            if _results_to_students(s) and out["my_responded"]:
                responses = await _load_responses(db, sid, qid)
                out["results"] = _aggregate(q, responses)

    if s.status == "ended" and _results_to_students(s):
        all_results = []
        for q in (s.questions or []):
            if not isinstance(q, dict):
                continue
            responses = await _load_responses(db, sid, str(q.get("id")))
            all_results.append({"question": q, "results": _aggregate(q, responses)})
        out["all_results"] = all_results

    return out


@router.post("/play/{sid}/respond")
async def respond(
    sid: int, body: PollRespondReq,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """현재 질문 응답 — choice는 1회, wordcloud는 1인당 max_words개."""
    s = await _get_session_or_404(db, sid)
    if s.status != "question":
        raise HTTPException(409, "지금은 응답을 받을 수 없습니다")
    pt = await _get_participant_or_403(db, sid, user)

    q = _question_at(s, s.current_index)
    if not q or str(q.get("id")) != body.question_id:
        raise HTTPException(409, "지금 진행 중인 질문이 아닙니다")
    qid = str(q.get("id"))

    existing = (await db.execute(
        select(PollResponse).where(
            PollResponse.session_id == sid,
            PollResponse.participant_id == pt.id,
            PollResponse.question_id == qid,
        )
    )).scalars().all()

    if q.get("type") == "choice":
        if existing:
            raise HTTPException(409, "이미 참여했습니다")
        options = q.get("options") or []
        valid = {chr(65 + i) for i in range(len(options))}
        sel_raw = body.answer.get("selected")
        sel = [x for x in sel_raw if x in valid] if isinstance(sel_raw, list) else []
        # dict.fromkeys — 중복 제거 + 순서 보존
        sel = list(dict.fromkeys(sel))
        if not sel:
            raise HTTPException(400, "보기를 선택하세요")
        if not q.get("multi") and len(sel) > 1:
            raise HTTPException(400, "하나만 선택할 수 있습니다")
        row = PollResponse(
            session_id=sid, participant_id=pt.id, question_id=qid,
            answer={"selected": sel}, answer_no=0,
        )
    else:
        max_words = max(1, min(5, int(q.get("max_words") or 1)))
        if len(existing) >= max_words:
            raise HTTPException(409, "단어를 모두 제출했습니다")
        word_raw = body.answer.get("word")
        word = _norm_word(word_raw) if isinstance(word_raw, str) else ""
        if not word:
            raise HTTPException(400, "단어를 입력하세요")
        mine_words = {
            _norm_word((r.answer or {}).get("word") or "")
            for r in existing
            if isinstance(r.answer, dict)
        }
        if word in mine_words:
            raise HTTPException(409, "이미 제출한 단어입니다")
        row = PollResponse(
            session_id=sid, participant_id=pt.id, question_id=qid,
            answer={"word": word}, answer_no=len(existing),
        )

    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        # 동시 더블클릭 — pre-check를 둘 다 통과한 경우 UNIQUE(slot)가 잡음
        raise HTTPException(409, "이미 제출했습니다")

    out: dict = {"ok": True}
    if q.get("type") == "wordcloud":
        out["my_remaining"] = max(0, max_words - len(existing) - 1)
    if _results_to_students(s):
        responses = await _load_responses(db, sid, qid)
        out["results"] = _aggregate(q, responses)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# 호스트 — 투표 상세/수정/삭제/세션 생성 (path param — literal 뒤에 등록)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{pid}")
async def get_poll(
    pid: int,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_poll_or_404(db, pid)
    _assert_owner(p, user)
    return _poll_dict(p)


@router.put("/{pid}")
async def update_poll(
    pid: int, body: PollUpdate, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    p = await _get_poll_or_404(db, pid)
    _assert_owner(p, user)
    if body.title is not None:
        p.title = body.title.strip()
    if body.description is not None:
        p.description = body.description.strip() or None
    if body.questions is not None:
        p.questions = _normalize_questions(body.questions)
    await db.flush()
    await db.refresh(p)  # onupdate updated_at expired — isoformat 접근 대비
    await log_action(db, user, "tools.poll.update", target=f"poll:{pid}", request=request)
    return _poll_dict(p)


@router.delete("/{pid}")
async def delete_poll(
    pid: int, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """드라이브 휴지통 이동 (30일 후 자동 영구 삭제 — drive cron)."""
    p = await _get_poll_or_404(db, pid)
    _assert_owner(p, user)
    p.deleted_at = _now()
    p.deleted_by = user.id
    await db.flush()
    await log_action(db, user, "tools.poll.trash", target=f"poll:{pid}", request=request)
    return {"ok": True}


@router.post("/{pid}/sessions")
async def create_session(
    pid: int, body: PollSessionCreate, request: Request,
    user: User = Depends(require_permission("tools.poll.host")),
    db: AsyncSession = Depends(get_db),
):
    """세션 생성 — 질문 snapshot + PIN 발급 (lobby 상태)."""
    p = await _get_poll_or_404(db, pid)
    _assert_owner(p, user)
    questions = [q for q in (p.questions or []) if isinstance(q, dict)]
    if not questions:
        raise HTTPException(400, "질문이 없습니다")

    merged_settings: dict = {"results_to_students": False}
    if body.settings and isinstance(body.settings, dict):
        merged_settings.update(body.settings)

    s = PollSession(
        poll_id=p.id,
        host_id=user.id,
        title=p.title,
        pin=await _gen_pin(db),
        status="lobby",
        current_index=0,
        questions=questions,
        settings=merged_settings,
    )
    db.add(s)
    await db.flush()
    await log_action(
        db, user, "tools.poll.session_create",
        target=f"poll_session:{s.id} poll:{pid} questions:{len(questions)}",
        request=request,
    )
    return {
        "id": s.id, "pin": s.pin, "title": s.title,
        "question_count": len(questions), "join_url": _join_url(s.pin),
    }
