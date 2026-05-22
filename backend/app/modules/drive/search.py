"""드라이브 통합 검색 — 본인 자료 + 폴더에서 제목/본문 검색.

ILIKE 기반 (PostgreSQL/SQLite 둘 다 지원). 자료 본문은 plain_text 필드 사용
(Hocuspocus snapshot 시 갱신됨). 추후 PostgreSQL full-text search로 업그레이드 가능.

엔드포인트: GET /api/drive/search?q=<쿼리>&type=<all|docs|...>&include_folders=true
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import (
    ClassroomDocument, ClassroomHwp, ClassroomPresentation, ClassroomSheet,
    ClassroomSlide, Folder, Survey, SurveyQuestion, User,
)
from app.modules.drive.router import ITEM_TYPES, router


# snippet 생성 — 매칭 위치 주변 텍스트 발췌
SNIPPET_HALF = 60


def _snippet(text: str | None, query: str) -> str | None:
    if not text:
        return None
    lower = text.lower()
    q_lower = query.lower()
    pos = lower.find(q_lower)
    if pos < 0:
        return None
    start = max(0, pos - SNIPPET_HALF)
    end = min(len(text), pos + len(query) + SNIPPET_HALF)
    snippet = text[start:end].replace("\n", " ").strip()
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet


@router.get("/search")
async def search_my_drive(
    q: str = Query(..., min_length=1, max_length=200),
    type: str = Query("all"),
    include_folders: bool = Query(True),
    include_trash: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_permission("drive.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 드라이브에서 제목·본문 검색.

    검색 대상:
      - 자료 5종: title (모두) + plain_text (docs/slides/decks)
      - 설문: title + description + question_text (질문 본문)
      - 폴더: name (include_folders=true일 때)

    결과 형식:
      - items: [{type, id, title, folder_id, updated_at, snippet, match_field}]
      - folders: [{id, name, parent_id, sort_order}]
      - total: 전체 매칭 수 (limit 적용 전)
    """
    q_stripped = q.strip()
    if not q_stripped:
        raise HTTPException(400, "검색어를 입력하세요")

    pattern = f"%{q_stripped}%"
    items: list[dict[str, Any]] = []
    folders_result: list[dict[str, Any]] = []

    # 자료 type별 검색
    types_to_search = (
        list(ITEM_TYPES.keys()) if type == "all" else [type]
    )
    if type != "all" and type not in ITEM_TYPES:
        raise HTTPException(400, f"잘못된 type: {type}")

    for t in types_to_search:
        Model, owner_field, label = ITEM_TYPES[t]

        # title 또는 plain_text 매칭
        conds = [Model.title.ilike(pattern)]
        if hasattr(Model, "plain_text"):
            conds.append(Model.plain_text.ilike(pattern))
        if t == "surveys":
            # surveys는 description도 검색
            if hasattr(Model, "description"):
                conds.append(Model.description.ilike(pattern))

        base_q = select(Model).where(
            getattr(Model, owner_field) == user.id,
            or_(*conds),
        )
        if not include_trash:
            base_q = base_q.where(Model.deleted_at.is_(None))
        base_q = base_q.order_by(Model.updated_at.desc()).limit(limit)

        rows = (await db.execute(base_q)).scalars().all()
        for r in rows:
            title_match = q_stripped.lower() in (r.title or "").lower()
            snippet = None
            match_field = "title" if title_match else None
            if not title_match and hasattr(r, "plain_text"):
                snippet = _snippet(r.plain_text, q_stripped)
                if snippet:
                    match_field = "body"
            if not match_field and t == "surveys" and hasattr(r, "description"):
                snippet = _snippet(r.description, q_stripped)
                if snippet:
                    match_field = "description"
            items.append({
                "type": t,
                "id": r.id,
                "title": r.title,
                "folder_id": getattr(r, "folder_id", None),
                "course_id": getattr(r, "course_id", None),
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                "match_field": match_field or "title",
                "snippet": snippet,
            })

    # decks의 ClassroomSlide도 검색 (deck에 속하는 slide의 plain_text)
    # → 매칭된 slide 발견 시 그 deck도 결과에 포함
    if type in ("all", "decks"):
        slide_rows = (await db.execute(
            select(ClassroomSlide, ClassroomPresentation)
            .join(ClassroomPresentation, ClassroomSlide.presentation_id == ClassroomPresentation.id)
            .where(
                ClassroomPresentation.owner_id == user.id,
                ClassroomPresentation.deleted_at.is_(None),
                ClassroomSlide.plain_text.ilike(pattern),
            )
            .limit(limit)
        )).all()
        existing_deck_ids = {it["id"] for it in items if it["type"] == "decks"}
        for sl, deck in slide_rows:
            if deck.id in existing_deck_ids:
                continue
            existing_deck_ids.add(deck.id)
            items.append({
                "type": "decks",
                "id": deck.id,
                "title": deck.title,
                "folder_id": deck.folder_id,
                "course_id": deck.course_id,
                "updated_at": deck.updated_at.isoformat() if deck.updated_at else None,
                "match_field": "slide_body",
                "snippet": _snippet(sl.plain_text, q_stripped),
            })

    # 설문지 질문 본문도 검색
    if type in ("all", "surveys"):
        q_rows = (await db.execute(
            select(SurveyQuestion, Survey)
            .join(Survey, SurveyQuestion.survey_id == Survey.id)
            .where(
                Survey.author_id == user.id,
                Survey.deleted_at.is_(None),
                SurveyQuestion.question_text.ilike(pattern),
            )
            .limit(limit)
        )).all()
        existing_survey_ids = {it["id"] for it in items if it["type"] == "surveys"}
        for sq, sv in q_rows:
            if sv.id in existing_survey_ids:
                continue
            existing_survey_ids.add(sv.id)
            items.append({
                "type": "surveys",
                "id": sv.id,
                "title": sv.title,
                "folder_id": sv.folder_id,
                "course_id": sv.course_id,
                "updated_at": sv.updated_at.isoformat() if sv.updated_at else None,
                "match_field": "question",
                "snippet": _snippet(sq.question_text, q_stripped),
            })

    # 폴더 검색
    if include_folders:
        f_rows = (await db.execute(
            select(Folder).where(
                Folder.owner_id == user.id,
                Folder.deleted_at.is_(None),
                Folder.name.ilike(pattern),
            ).order_by(Folder.sort_order).limit(limit)
        )).scalars().all()
        for f in f_rows:
            folders_result.append({
                "id": f.id,
                "name": f.name,
                "parent_id": f.parent_id,
                "sort_order": f.sort_order,
                "is_system_locked": f.is_system_locked,
            })

    # 정렬 — 제목 매칭 우선, 본문 매칭 그 다음, updated_at desc
    def _rank(it):
        field_rank = {"title": 0, "description": 1, "question": 1, "slide_body": 2, "body": 2}
        return (field_rank.get(it["match_field"], 3), -(it["updated_at"] or ""))

    items.sort(key=lambda x: (
        0 if x["match_field"] == "title" else 1,
        -(0 if x["updated_at"] is None else 1),  # has updated_at first
    ))

    return {
        "query": q_stripped,
        "total": len(items),
        "items": items[:limit],
        "folders": folders_result,
    }
