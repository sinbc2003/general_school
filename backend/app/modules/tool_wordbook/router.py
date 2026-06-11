"""단어장 (ClassCard형) 라우터.

엔드포인트:
  관리 (tools.wordbook.manage — 교사):
    GET    /api/tools/wordbook/decks                 — 본인 덱 list (+카드 수)
    POST   /api/tools/wordbook/decks                 — 덱 생성
    GET    /api/tools/wordbook/decks/{did}           — 덱 + 카드 전체 (편집용)
    PUT    /api/tools/wordbook/decks/{did}           — 메타 수정
    DELETE /api/tools/wordbook/decks/{did}           — 삭제 (카드·진도 CASCADE)
    POST   /api/tools/wordbook/decks/{did}/cards     — 카드 1개 추가
    PUT    /api/tools/wordbook/cards/{cid}           — 카드 수정
    DELETE /api/tools/wordbook/cards/{cid}           — 카드 삭제
    POST   /api/tools/wordbook/decks/{did}/cards/_bulk   — 일괄 추가 (max 2000)
    POST   /api/tools/wordbook/decks/{did}/cards/_import — CSV 업로드
    GET    /api/tools/wordbook/csv-template          — CSV 양식

  학습 (인증 + 접근 가드 — 소유자/admin/공개/강좌 첨부):
    GET  /api/tools/wordbook/study-home              — 최근 학습 + 공개 덱
    GET  /api/tools/wordbook/decks/{did}/study       — 카드 + 본인 라이트너 상태
    POST /api/tools/wordbook/decks/{did}/progress    — 결과 1건 (box 갱신)

라이트너: 맞히면 box+1 (max 5), 틀리면 box=1. 출제 우선순위는 frontend가
box 오름차순 + last_seen 오래된 순으로 세션 구성.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import Text as SaText, cast, func as sa_func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.core.upload import POLICY_CSV, validate_upload
from app.models import (
    CoursePost, CourseStudent, User,
    WordCard, WordDeck, WordStudyState,
)
from app.modules.tool_wordbook.schemas import (
    CardIn, CardUpdate, CardsBulkIn, DeckCreate, DeckUpdate, ProgressIn, ShareAdd,
)

router = APIRouter(prefix="/api/tools/wordbook", tags=["tool-wordbook"])

MAX_CARDS_PER_DECK = 2000
LEITNER_MAX_BOX = 5


# ─────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────────────────────────────

async def _get_deck_or_404(db: AsyncSession, did: int) -> WordDeck:
    d = await db.get(WordDeck, did)
    if not d:
        raise HTTPException(404, "덱 없음")
    return d


def _assert_owner(d: WordDeck, user: User) -> None:
    if d.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인 덱만 편집 가능")


async def _has_classroom_attachment(
    db: AsyncSession, user: User, deck_id: int,
) -> bool:
    """본인 소속 강좌 글에 이 덱이 word_deck으로 첨부됐는지 (attachment_share 패턴)."""
    student_ids = (await db.execute(
        select(CourseStudent.course_id).where(
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalars().all()
    if not student_ids:
        return False
    # JSON→text LIKE는 prefilter — 실제 매칭은 Python에서
    rows = (await db.execute(
        select(CoursePost.attachments).where(
            CoursePost.course_id.in_(set(student_ids)),
            CoursePost.attachments.isnot(None),
            cast(CoursePost.attachments, SaText).like('%"word_deck_id"%'),
        )
    )).scalars().all()
    for atts in rows:
        if not isinstance(atts, list):
            continue
        for a in atts:
            if (
                isinstance(a, dict)
                and a.get("type") == "word_deck"
                and a.get("word_deck_id") == deck_id
            ):
                return True
    return False


async def _assert_study_access(
    db: AsyncSession, user: User, d: WordDeck,
) -> None:
    if d.owner_id == user.id or is_admin(user) or d.is_public:
        return
    # 학기 무관 — 지난 학기 첨부로도 계속 복습 가능 (어휘 학습 연속성).
    # 보드와 다른 정책: 보드는 라이브 활동이라 활성 학기 첨부만 허용.
    if await _has_classroom_attachment(db, user, d.id):
        return
    # 동료 교사 공유 — 원본 열람(학습 미리보기) 가능
    from app.services.tool_share import is_shared_to
    if await is_shared_to(db, "word_deck", d.id, user.id):
        return
    raise HTTPException(403, "이 단어장에 접근 권한이 없습니다")


def _deck_to_dict(d: WordDeck, card_count: int | None = None) -> dict:
    out = {
        "id": d.id,
        "owner_id": d.owner_id,
        "title": d.title,
        "description": d.description,
        "lang_pair": d.lang_pair,
        "is_public": d.is_public,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }
    if card_count is not None:
        out["card_count"] = card_count
    return out


def _card_to_dict(c: WordCard) -> dict:
    return {
        "id": c.id,
        "term": c.term,
        "meaning": c.meaning,
        "example": c.example,
        "sort_order": c.sort_order,
    }


async def _card_counts(db: AsyncSession, deck_ids: list[int]) -> dict[int, int]:
    if not deck_ids:
        return {}
    rows = (await db.execute(
        select(WordCard.deck_id, sa_func.count(WordCard.id))
        .where(WordCard.deck_id.in_(deck_ids))
        .group_by(WordCard.deck_id)
    )).all()
    return {r[0]: r[1] for r in rows}


async def _next_sort_order(db: AsyncSession, did: int) -> int:
    mx = (await db.execute(
        select(sa_func.max(WordCard.sort_order)).where(WordCard.deck_id == did)
    )).scalar_one()
    return (mx or 0) + 1


async def _assert_card_capacity(db: AsyncSession, did: int, adding: int) -> None:
    cnt = (await db.execute(
        select(sa_func.count(WordCard.id)).where(WordCard.deck_id == did)
    )).scalar_one()
    if cnt + adding > MAX_CARDS_PER_DECK:
        raise HTTPException(400, f"덱당 최대 {MAX_CARDS_PER_DECK}개 카드까지 가능합니다")


# ─────────────────────────────────────────────────────────────────────────────
# 관리 (교사)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/decks")
async def my_decks(
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(WordDeck).where(WordDeck.owner_id == user.id)
        .order_by(WordDeck.updated_at.desc())
    )).scalars().all()
    counts = await _card_counts(db, [d.id for d in rows])
    return {"items": [_deck_to_dict(d, counts.get(d.id, 0)) for d in rows]}


@router.post("/decks")
async def create_deck(
    body: DeckCreate, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = WordDeck(
        owner_id=user.id,
        title=body.title,
        description=body.description,
        lang_pair=body.lang_pair,
        is_public=body.is_public,
    )
    db.add(d)
    await db.flush()
    await log_action(db, user, "tools.wordbook.deck_create", target=f"deck:{d.id}", request=request)
    return _deck_to_dict(d, 0)


@router.get("/decks/{did}")
async def get_deck(
    did: int,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    """편집용 — 덱 + 카드 전체 (소유자/admin)."""
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    cards = (await db.execute(
        select(WordCard).where(WordCard.deck_id == did)
        .order_by(WordCard.sort_order.asc(), WordCard.id.asc())
    )).scalars().all()
    return {**_deck_to_dict(d, len(cards)), "cards": [_card_to_dict(c) for c in cards]}


@router.put("/decks/{did}")
async def update_deck(
    did: int, body: DeckUpdate, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(d, k, v)
    await db.flush()
    await db.refresh(d)
    await log_action(db, user, "tools.wordbook.deck_update", target=f"deck:{did}", request=request)
    return _deck_to_dict(d)


@router.delete("/decks/{did}")
async def delete_deck(
    did: int, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    from app.services.tool_share import cleanup_shares
    await cleanup_shares(db, "word_deck", did)
    await db.delete(d)  # cards/states CASCADE
    await db.flush()
    await log_action(db, user, "tools.wordbook.deck_delete", target=f"deck:{did}", request=request)
    return {"ok": True}


# ── 동료 교사 공유 + 사본 ──

# NOTE: /decks/{did}가 먼저 등록돼 있어 /decks/* 하위 literal 경로는 먹힌다
# (FastAPI는 등록 순서 매칭 + path param은 [^/]+). 최상위 경로 사용.
@router.get("/shared-with-me")
async def shared_with_me(
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    """나에게 공유된 단어장 목록 (열람·학습 미리보기 + 사본 생성 가능)."""
    from app.services.tool_share import shared_tool_ids
    ids = await shared_tool_ids(db, "word_deck", user.id)
    if not ids:
        return {"items": []}
    rows = (await db.execute(
        select(WordDeck, User.name)
        .join(User, User.id == WordDeck.owner_id)
        .where(WordDeck.id.in_(ids))
        .order_by(WordDeck.updated_at.desc())
    )).all()
    counts = await _card_counts(db, [d.id for d, _ in rows])
    return {
        "items": [
            {**_deck_to_dict(d, counts.get(d.id, 0)), "owner_name": name}
            for d, name in rows
        ]
    }


@router.get("/decks/{did}/shares")
async def list_deck_shares(
    did: int,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import list_shares
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    return {"items": await list_shares(db, "word_deck", did)}


@router.post("/decks/{did}/shares")
async def add_deck_share(
    did: int, body: ShareAdd, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import add_share
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    out = await add_share(
        db, tool_type="word_deck", tool_id=did,
        target_user_id=body.user_id, shared_by=user.id,
    )
    await log_action(db, user, "tools.wordbook.share", target=f"deck:{did} to:{body.user_id}", request=request)
    return out


@router.delete("/decks/{did}/shares/{share_id}")
async def remove_deck_share(
    did: int, share_id: int,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    from app.services.tool_share import remove_share
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    await remove_share(db, tool_type="word_deck", tool_id=did, share_id=share_id)
    return {"ok": True}


@router.post("/decks/{did}/duplicate")
async def duplicate_deck(
    did: int, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    """사본 생성 — 소유자/공유받은 교사/관리자. 카드까지 복제 (학습 진도는 제외).

    공유받은 교사가 본인 수업에 쓸 때의 흐름: 원본 열람 → 사본 → 본인 강좌에 첨부.
    """
    from app.services.tool_share import is_shared_to
    src = await _get_deck_or_404(db, did)
    if not (
        src.owner_id == user.id
        or is_admin(user)
        or await is_shared_to(db, "word_deck", did, user.id)
    ):
        raise HTTPException(403, "공유받은 단어장만 사본을 만들 수 있습니다")

    copy = WordDeck(
        owner_id=user.id,
        title=f"{src.title} (사본)"[:255],
        description=src.description,
        lang_pair=src.lang_pair,
        is_public=False,
    )
    db.add(copy)
    await db.flush()

    cards = (await db.execute(
        select(WordCard).where(WordCard.deck_id == did)
        .order_by(WordCard.sort_order.asc(), WordCard.id.asc())
    )).scalars().all()
    for c in cards:
        db.add(WordCard(
            deck_id=copy.id, term=c.term, meaning=c.meaning,
            example=c.example, sort_order=c.sort_order,
        ))
    await db.flush()
    await log_action(db, user, "tools.wordbook.duplicate", target=f"deck:{did} -> {copy.id}", request=request)
    return _deck_to_dict(copy, len(cards))


@router.post("/decks/{did}/cards")
async def add_card(
    did: int, body: CardIn,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    await _assert_card_capacity(db, did, 1)
    c = WordCard(
        deck_id=did,
        term=body.term.strip(),
        meaning=body.meaning.strip(),
        example=(body.example or "").strip() or None,
        sort_order=await _next_sort_order(db, did),
    )
    db.add(c)
    await db.flush()
    return _card_to_dict(c)


@router.put("/cards/{cid}")
async def update_card(
    cid: int, body: CardUpdate,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(WordCard, cid)
    if not c:
        raise HTTPException(404)
    d = await _get_deck_or_404(db, c.deck_id)
    _assert_owner(d, user)
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(c, k, v.strip() if isinstance(v, str) else v)
    await db.flush()
    return _card_to_dict(c)


@router.delete("/cards/{cid}")
async def delete_card(
    cid: int,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(WordCard, cid)
    if not c:
        raise HTTPException(404)
    d = await _get_deck_or_404(db, c.deck_id)
    _assert_owner(d, user)
    await db.delete(c)
    await db.flush()
    return {"ok": True}


@router.post("/decks/{did}/cards/_bulk")
async def add_cards_bulk(
    did: int, body: CardsBulkIn, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    items = [i for i in body.items if i.term.strip() and i.meaning.strip()]
    if not items:
        raise HTTPException(400, "추가할 카드가 없습니다")
    await _assert_card_capacity(db, did, len(items))
    base = await _next_sort_order(db, did)
    for idx, i in enumerate(items):
        db.add(WordCard(
            deck_id=did,
            term=i.term.strip()[:255],
            meaning=i.meaning.strip()[:500],
            example=(i.example or "").strip() or None,
            sort_order=base + idx,
        ))
    await db.flush()
    await log_action(
        db, user, "tools.wordbook.cards_bulk_add",
        target=f"deck:{did} cards:{len(items)}", request=request,
    )
    return {"ok": True, "added": len(items)}


# 헤더 판정: 1열 AND 2열이 모두 헤더 토큰일 때만 skip.
# (1열만 보면 "word" 같은 정상 단어 행을 헤더로 오인할 수 있음)
_CSV_TERM_TOKENS = {"term", "단어", "word"}
_CSV_MEANING_TOKENS = {"meaning", "뜻", "의미"}


@router.post("/decks/{did}/cards/_import")
async def import_cards_csv(
    did: int, file: UploadFile, request: Request,
    user: User = Depends(require_permission("tools.wordbook.manage")),
    db: AsyncSession = Depends(get_db),
):
    """CSV 업로드 — 열: 단어,뜻,예문(선택). 첫 행이 헤더면 자동 skip."""
    d = await _get_deck_or_404(db, did)
    _assert_owner(d, user)
    data = await validate_upload(file, POLICY_CSV)

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = data.decode("cp949")  # 한국 Excel 저장 기본
        except UnicodeDecodeError:
            raise HTTPException(400, "인코딩을 읽을 수 없습니다 (UTF-8 또는 CP949)")

    rows = list(csv.reader(io.StringIO(text)))
    if (
        rows and len(rows[0]) >= 2
        and rows[0][0].strip().lower() in _CSV_TERM_TOKENS
        and rows[0][1].strip().lower() in _CSV_MEANING_TOKENS
    ):
        rows = rows[1:]

    items: list[CardIn] = []
    skipped = 0
    for r in rows:
        if len(r) < 2 or not r[0].strip() or not r[1].strip():
            if any(x.strip() for x in r):
                skipped += 1
            continue
        items.append(CardIn(
            term=r[0].strip()[:255],
            meaning=r[1].strip()[:500],
            example=(r[2].strip()[:2000] if len(r) > 2 and r[2].strip() else None),
        ))
        if len(items) > MAX_CARDS_PER_DECK:
            raise HTTPException(400, f"한 번에 최대 {MAX_CARDS_PER_DECK}행까지")

    if not items:
        raise HTTPException(400, "가져올 행이 없습니다 (열: 단어,뜻,예문)")
    await _assert_card_capacity(db, did, len(items))

    base = await _next_sort_order(db, did)
    for idx, i in enumerate(items):
        db.add(WordCard(
            deck_id=did, term=i.term, meaning=i.meaning,
            example=i.example, sort_order=base + idx,
        ))
    await db.flush()
    await log_action(
        db, user, "tools.wordbook.cards_import",
        target=f"deck:{did} added:{len(items)} skipped:{skipped}", request=request,
    )
    return {"ok": True, "added": len(items), "skipped": skipped}


@router.get("/csv-template")
async def csv_template(
    user: User = Depends(require_permission("tools.wordbook.manage")),
):
    content = "﻿단어,뜻,예문\napple,사과,I ate an apple.\nrun,달리다,\n"
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="wordbook_template.csv"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 학습 (인증 + 접근 가드)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/study-home")
async def study_home(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 홈 — 최근 학습한 덱 + 공개 덱."""
    # 최근 학습 — 본인 state가 있는 덱, 최근 학습순
    recent_rows = (await db.execute(
        select(
            WordStudyState.deck_id,
            sa_func.max(WordStudyState.last_seen).label("latest"),
            sa_func.count(WordStudyState.id),
            sa_func.sum(WordStudyState.wrong_count),
        )
        .where(WordStudyState.user_id == user.id)
        .group_by(WordStudyState.deck_id)
        .order_by(sa_func.max(WordStudyState.last_seen).desc())
        .limit(10)
    )).all()
    recent_ids = [r[0] for r in recent_rows]

    public_rows = (await db.execute(
        select(WordDeck).where(WordDeck.is_public == True)  # noqa: E712
        .order_by(WordDeck.updated_at.desc()).limit(50)
    )).scalars().all()

    all_ids = list({*recent_ids, *[d.id for d in public_rows]})
    decks = (await db.execute(
        select(WordDeck).where(WordDeck.id.in_(all_ids))
    )).scalars().all() if all_ids else []
    deck_by_id = {d.id: d for d in decks}
    counts = await _card_counts(db, all_ids)

    recent_out = []
    for deck_id, latest, studied_cards, _wrong_sum in recent_rows:
        d = deck_by_id.get(deck_id)
        if not d:
            continue
        recent_out.append({
            **_deck_to_dict(d, counts.get(deck_id, 0)),
            "studied_cards": studied_cards,
            "last_studied_at": latest.isoformat() if latest else None,
        })

    return {
        "recent": recent_out,
        "public": [
            _deck_to_dict(d, counts.get(d.id, 0))
            for d in public_rows
        ],
    }


@router.get("/decks/{did}/study")
async def study_deck(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학습용 — 카드 전체 + 본인 라이트너 상태."""
    d = await _get_deck_or_404(db, did)
    await _assert_study_access(db, user, d)

    cards = (await db.execute(
        select(WordCard).where(WordCard.deck_id == did)
        .order_by(WordCard.sort_order.asc(), WordCard.id.asc())
    )).scalars().all()
    states = (await db.execute(
        select(WordStudyState).where(
            WordStudyState.deck_id == did,
            WordStudyState.user_id == user.id,
        )
    )).scalars().all()
    state_by_card = {
        s.card_id: {
            "box": s.box,
            "correct_count": s.correct_count,
            "wrong_count": s.wrong_count,
            "last_seen": s.last_seen.isoformat() if s.last_seen else None,
        }
        for s in states
    }
    return {
        **_deck_to_dict(d, len(cards)),
        "cards": [_card_to_dict(c) for c in cards],
        "states": state_by_card,
    }


@router.post("/decks/{did}/progress")
async def record_progress(
    did: int, body: ProgressIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학습 결과 1건 — 라이트너 박스 갱신 (맞히면 +1 max5, 틀리면 1)."""
    d = await _get_deck_or_404(db, did)
    await _assert_study_access(db, user, d)

    card = await db.get(WordCard, body.card_id)
    if not card or card.deck_id != did:
        raise HTTPException(404, "카드 없음")

    s = (await db.execute(
        select(WordStudyState).where(
            WordStudyState.user_id == user.id,
            WordStudyState.card_id == body.card_id,
        )
    )).scalar_one_or_none()
    if not s:
        s = WordStudyState(deck_id=did, card_id=body.card_id, user_id=user.id)
        db.add(s)

    if body.correct:
        s.box = min(LEITNER_MAX_BOX, (s.box or 1) + 1)
        s.correct_count = (s.correct_count or 0) + 1
    else:
        s.box = 1
        s.wrong_count = (s.wrong_count or 0) + 1
    s.last_seen = datetime.now(timezone.utc)
    try:
        await db.flush()
    except IntegrityError:
        # 동시 더블 요청 — 먼저 만든 쪽이 UNIQUE 선점. 학습 흐름엔 영향 없음.
        raise HTTPException(409, "동시 요청 — 다시 시도하세요")

    return {"ok": True, "box": s.box}
