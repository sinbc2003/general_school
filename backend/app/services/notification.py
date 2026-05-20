"""알림 발송 서비스.

사용:
    from app.services.notification import notify_users

    await notify_users(
        db,
        user_ids=[student.id for student in students],
        type="classroom.assignment.new",
        title=f"{course.name} 새 과제: {post.title}",
        body=post.content[:200] if post.content else None,
        link_url=f"/s/classroom/{course.id}/posts/{post.id}",
        source_user_id=teacher.id,
        meta={"course_id": course.id, "post_id": post.id},
    )

설계 원칙:
- 트리거 함수는 한 호출로 N명에게 fan-out
- 본인 → 본인 알림 skip (예: 교사가 자기 강좌에 글 쓰면 본인에겐 알림 X)
- DB add만 하고 commit은 호출 라우터의 트랜잭션에 위임 (실패 시 같이 rollback)
- 알림 생성 자체가 실패해도 원 작업(글 게시)은 막지 않도록 try/except 권장

향후 확장:
- 사용자별 알림 설정 (type별 끄기) — 추가 모델 필요
- Web Push: pywebpush + Service Worker 추가
- Email/Slack fallback
"""

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification

log = logging.getLogger(__name__)


async def notify_users(
    db: AsyncSession,
    *,
    user_ids: list[int],
    type: str,
    title: str,
    body: str | None = None,
    link_url: str | None = None,
    source_user_id: int | None = None,
    meta: dict[str, Any] | None = None,
) -> int:
    """대상 사용자 N명에게 알림 생성. 본인 자신은 자동 skip.

    returns: 실제 생성된 알림 수
    """
    # 중복 제거 + 본인 발신자 제외
    targets = [uid for uid in set(user_ids) if uid and uid != source_user_id]
    if not targets:
        return 0

    rows = [
        Notification(
            user_id=uid,
            type=type,
            title=title[:255],
            body=body[:5000] if body else None,
            link_url=link_url[:500] if link_url else None,
            source_user_id=source_user_id,
            meta=meta,
        )
        for uid in targets
    ]
    db.add_all(rows)
    try:
        await db.flush()
    except Exception as e:
        # 알림은 best-effort — 원 작업을 막지 않음
        log.warning("notify_users flush failed type=%s err=%s", type, e)
        return 0
    return len(rows)
