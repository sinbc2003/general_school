"""알림 스케줄러 — 마감 임박 과제 reminder.

배경: 학생이 과제 게시 알림을 놓치거나 마감 직전에 깜빡하는 경우 흔함.
마감 24시간 전에 한 번 reminder 보내면 미제출률이 줄어듬.

설계:
- backend 프로세스 안에서 asyncio background task (backup_scheduler와 동일 패턴)
- 1시간(3600s) 주기로 tick
- 매 tick:
  1) Assignment 중 due_date가 23~25시간 후 + due_reminder_sent_at IS NULL
  2) 해당 강좌(같은 학기 + 같은 과목) active 학생 찾기
  3) 학생 중 AssignmentSubmission 없는 사람만 알림 발송
  4) Assignment.due_reminder_sent_at = now()로 갱신 → 중복 차단

중복 방지:
- 윈도 1시간(23~25) + due_reminder_sent_at 마크 → 한 과제당 정확히 1회

운영:
- backend 재시작 시 자동 시작
- 백그라운드라 다른 요청 차단 X
- 실패해도 task 죽지 않음 (예외 잡고 다음 tick까지 sleep)
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Course, CourseStudent
from app.models.user import User

log = logging.getLogger(__name__)

# Tick 주기 (초). 1시간 = 3600.
TICK_SECONDS = 3600
# 마감 윈도 (시간) — due_date가 [WINDOW_LOW, WINDOW_HIGH] 시간 후 범위면 발송 대상.
WINDOW_LOW_HOURS = 23
WINDOW_HIGH_HOURS = 25


async def _send_due_reminders(db: AsyncSession) -> int:
    """한 번 실행 — 발송된 알림 수 반환."""
    from app.services.notification import notify_users

    now = datetime.now(timezone.utc)
    low = now + timedelta(hours=WINDOW_LOW_HOURS)
    high = now + timedelta(hours=WINDOW_HIGH_HOURS)

    # 윈도 안 + 아직 미발송인 과제
    rows = (await db.execute(
        select(Assignment).where(
            Assignment.due_date >= low,
            Assignment.due_date <= high,
            Assignment.due_reminder_sent_at.is_(None),
        )
    )).scalars().all()

    if not rows:
        return 0

    total_notified = 0
    for a in rows:
        try:
            # 같은 학기 + 과목의 강좌들 (한 과목이 여러 강좌일 수도)
            courses = (await db.execute(
                select(Course).where(
                    Course.semester_id == a.semester_id,
                    Course.subject == a.subject,
                )
            )).scalars().all()
            if not courses:
                # 강좌 매핑 없으면 그냥 mark만 (중복 발송 방지)
                a.due_reminder_sent_at = now
                continue

            course_ids = [c.id for c in courses]
            # 강좌 active 학생들
            student_ids = (await db.execute(
                select(CourseStudent.student_id).where(
                    CourseStudent.course_id.in_(course_ids),
                    CourseStudent.status == "active",
                )
            )).scalars().all()
            student_ids = list(set(student_ids))

            if not student_ids:
                a.due_reminder_sent_at = now
                continue

            # 미제출자만 (이미 제출한 학생에겐 reminder 의미 X)
            submitted_ids = (await db.execute(
                select(AssignmentSubmission.user_id).where(
                    AssignmentSubmission.assignment_id == a.id,
                    AssignmentSubmission.user_id.in_(student_ids),
                )
            )).scalars().all()
            pending_ids = [uid for uid in student_ids if uid not in set(submitted_ids)]

            if pending_ids:
                # 시간 표시: ko 로컬
                due_str = a.due_date.astimezone().strftime("%m/%d %H:%M")
                count = await notify_users(
                    db, user_ids=pending_ids,
                    type="assignment.due_reminder",
                    title=f"⏰ 과제 마감 임박: {a.title}",
                    body=f"마감 {due_str}까지 약 24시간 남았습니다. 아직 제출하지 않았다면 서둘러주세요.",
                    link_url=f"/s/assignments/{a.id}",
                    source_user_id=None,
                    meta={"assignment_id": a.id, "due_date": a.due_date.isoformat()},
                )
                total_notified += count

            # 마크 (중복 방지) — 학생 0명이어도 마크
            a.due_reminder_sent_at = now
        except Exception as e:
            log.warning("due reminder for assignment %s failed: %s", a.id, e)
            # 다음 tick 재시도 위해 mark 안 함

    await db.flush()
    return total_notified


# 휴지통 purge tick — 하루 1회. 매 tick(시간) 마다 last_purge_at 비교.
TRASH_PURGE_INTERVAL_HOURS = 24
_last_purge_at: datetime | None = None


async def _maybe_purge_trash(db: AsyncSession) -> int:
    """24시간에 한 번 휴지통 30일 경과 자료 hard delete + quota 환원."""
    global _last_purge_at
    now = datetime.now(timezone.utc)
    if _last_purge_at and (now - _last_purge_at) < timedelta(hours=TRASH_PURGE_INTERVAL_HOURS):
        return 0
    from app.modules.drive.router import purge_expired_trash
    result = await purge_expired_trash(db)
    _last_purge_at = now
    if result["deleted_total"] > 0:
        log.info(
            "[NOTIF SCHED] 휴지통 자동 purge — %d개 삭제, %d MB 환원",
            result["deleted_total"], result["freed_bytes_total"] // 1024 // 1024,
        )
    return result["deleted_total"]


async def _scheduler_loop() -> None:
    """무한 루프 — 1시간마다 tick."""
    log.info("[NOTIF SCHED] 시작 (tick %ds, window %d~%dh)",
             TICK_SECONDS, WINDOW_LOW_HOURS, WINDOW_HIGH_HOURS)
    # 첫 tick은 30초 후 (startup race 회피)
    await asyncio.sleep(30)
    while True:
        try:
            async with async_session_factory() as db:
                try:
                    cnt = await _send_due_reminders(db)
                    await _maybe_purge_trash(db)
                    await db.commit()
                    if cnt > 0:
                        log.info("[NOTIF SCHED] 마감 임박 reminder %d건 발송", cnt)
                except Exception as e:
                    await db.rollback()
                    log.warning("[NOTIF SCHED] tick failed: %s", e)
        except asyncio.CancelledError:
            log.info("[NOTIF SCHED] 정상 종료")
            raise
        except Exception as e:
            log.warning("[NOTIF SCHED] 루프 예외 (계속 실행): %s", e)
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> asyncio.Task:
    """lifespan에서 호출. asyncio.Task 반환."""
    return asyncio.create_task(_scheduler_loop(), name="notification_scheduler")
