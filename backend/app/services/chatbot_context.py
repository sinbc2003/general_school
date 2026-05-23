"""챗봇 참고 자료 → system_prompt 자동 prepend 생성기.

start-session 시 CourseChatbot.context_attachments(list[dict])를 받아
강좌 자료 본문을 추출 + 합쳐 system_prompt 앞에 붙일 텍스트를 반환.

지원 자료:
  - doc  : ClassroomDocument.plain_text 직접 사용
  - deck : ClassroomSlide.plain_text 합치기 (order asc)
  - sheet: plain_text 없음 → 제목만 prepend (참조 안내용)
  - hwp  : 텍스트 추출 어려움 → 제목만 prepend

한도:
  - 자료당 PER_ITEM_MAX(5000자)
  - 전체 TOTAL_MAX(30000자) 초과 시 그 이후 자료는 "생략" 메시지로 대체
  - 본인 강좌의 자료만 추출 (chatbot.course_id로 cross-course leak 방지)
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ClassroomDocument,
    ClassroomHwp,
    ClassroomPresentation,
    ClassroomSheet,
    ClassroomSlide,
)


PER_ITEM_MAX = 5000
TOTAL_MAX = 30_000


_LABELS = {
    "doc": "문서",
    "sheet": "시트",
    "deck": "슬라이드",
    "hwp": "한컴 문서",
}


async def build_context_text(
    db: AsyncSession,
    attachments: list[dict] | None,
) -> str:
    """system_prompt 앞에 prepend할 text. 빈 attachments면 빈 문자열."""
    if not attachments:
        return ""

    sections: list[str] = []
    total = 0
    skipped = 0
    for a in attachments:
        t = (a.get("type") or "").lower()
        aid = a.get("id")
        title = (a.get("title") or "").strip()
        if not (t and isinstance(aid, int) and title):
            continue
        body = await _get_body(db, t, aid)
        section = _format_section(t, title, body)
        if total + len(section) > TOTAL_MAX:
            skipped = len(attachments) - len(sections)
            break
        sections.append(section)
        total += len(section)

    if not sections:
        return ""
    out = "=== 강좌 참고 자료 ===\n" + "\n\n".join(sections)
    if skipped > 0:
        out += f"\n\n[참고 자료 한도 초과 — 나머지 {skipped}개 생략]"
    return out


async def _get_body(db: AsyncSession, t: str, aid: int) -> str | None:
    """자료 본문(plain_text) 추출. 없으면 None — 호출측이 제목만 표시."""
    if t == "doc":
        obj = await db.get(ClassroomDocument, aid)
        return (obj.plain_text or "").strip() if obj else None
    if t == "deck":
        # presentation 존재 확인 (없으면 None)
        deck = await db.get(ClassroomPresentation, aid)
        if not deck:
            return None
        rows = (await db.execute(
            select(ClassroomSlide.title, ClassroomSlide.plain_text, ClassroomSlide.order)
            .where(ClassroomSlide.presentation_id == aid)
            .order_by(ClassroomSlide.order)
        )).all()
        if not rows:
            return None
        parts: list[str] = []
        for i, (stitle, stext, _) in enumerate(rows, start=1):
            label = stitle.strip() if stitle else f"슬라이드 {i}"
            body = (stext or "").strip()
            if body:
                parts.append(f"[{label}]\n{body}")
            else:
                parts.append(f"[{label}]")
        return "\n\n".join(parts) if parts else None
    if t == "sheet":
        obj = await db.get(ClassroomSheet, aid)
        # plain_text 없음 — 존재 검증만
        return None if obj else None
    if t == "hwp":
        obj = await db.get(ClassroomHwp, aid)
        return None if obj else None
    return None


def _format_section(t: str, title: str, body: str | None) -> str:
    label = _LABELS.get(t, t)
    if not body:
        return f"## {label}: {title}\n(제목만 참조 — 본문 추출 미지원)"
    truncated = body[:PER_ITEM_MAX]
    suffix = "\n[자료가 길어 일부만 발췌]" if len(body) > PER_ITEM_MAX else ""
    return f"## {label}: {title}\n{truncated}{suffix}"
