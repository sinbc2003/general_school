"""알림 스케줄러 — 마감 임박 과제 reminder.

배경: 학생이 과제 게시 알림을 놓치거나 마감 직전에 깜빡하는 경우 흔함.
마감 24시간 전에 한 번 reminder 보내면 미제출률이 줄어듬.

설계:
- backend 프로세스 안에서 asyncio background task (backup_scheduler와 동일 패턴)
- 1시간(3600s) 주기로 tick
- 매 tick:
  1) Assignment 중 due_date가 23~25시간 후 + due_reminder_sent_at IS NULL
     + is_visible=True + status=ACTIVE (= 학생에게 실제 노출되는 과제만)
  2) 같은 학기 active 학생 찾기 (list_assignments와 동일 노출 기준).
     target_grades 지정 시 해당 학년 학생만.
  3) 학생 중 AssignmentSubmission 없는(미제출) 사람만 알림 발송
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
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, engine, is_sqlite
from app.models.assignment import Assignment, AssignmentStatus, AssignmentSubmission
from app.models.storage_volume import StorageVolume
from app.models.timetable import SemesterEnrollment
from app.models.user import User

log = logging.getLogger(__name__)

# Tick 주기 (초). 1시간 = 3600.
TICK_SECONDS = 3600
# 마감 윈도 (시간) — due_date가 [WINDOW_LOW, WINDOW_HIGH] 시간 후 범위면 발송 대상.
WINDOW_LOW_HOURS = 23
WINDOW_HIGH_HOURS = 25

# 멀티워커(gunicorn) 환경에서 스케줄러를 워커 1개만 실행하기 위한 Postgres advisory
# lock 키. registration.py의 SCREGIST(0x5343...)와 충돌 안 나는 별도 값 "GSNOTIFY".
SCHEDULER_LOCK_KEY = 0x47534E4F54494659
# _acquire_scheduler_lock가 "다른 워커가 이미 보유" 를 알리는 sentinel.
_LOCK_SKIP = object()

# 알림 본문의 마감 시각 표기용 — 서버 TZ가 UTC여도 한국 학생 기준(KST)으로 표시.
try:
    from zoneinfo import ZoneInfo
    _KST = ZoneInfo("Asia/Seoul")
except Exception:  # tzdata 없으면 서버 로컬로 폴백
    _KST = None


# ─────────────────────────────────────────────────────────────────────────────
# 시스템 에러 알림 — scheduler/cron 실패 시 super_admin에게 1회 알림 (24h 쿨다운)
# ─────────────────────────────────────────────────────────────────────────────

# rate-limit: error_type별 마지막 알림 시각 캐시 (in-memory)
_failure_notify_last: dict[str, datetime] = {}
FAILURE_NOTIFY_COOLDOWN_HOURS = 24


async def _notify_scheduler_failure(error_type: str, error_msg: str) -> None:
    """scheduler 실패 시 super_admin 알림 (24h 쿨다운, best-effort).

    같은 error_type이 24시간 안에 재발생 시 skip → 알림 폭주 방지.
    notify_users 실패해도 상위로 전파하지 않음.
    """
    now = datetime.now(timezone.utc)
    last = _failure_notify_last.get(error_type)
    if last and (now - last) < timedelta(hours=FAILURE_NOTIFY_COOLDOWN_HOURS):
        return
    _failure_notify_last[error_type] = now

    try:
        from app.services.notification import notify_users

        async with async_session_factory() as db:
            admin_ids = (
                await db.execute(
                    select(User.id).where(
                        User.role == "super_admin",
                        User.status != "disabled",
                    )
                )
            ).scalars().all()
            if not admin_ids:
                return
            try:
                await notify_users(
                    db,
                    user_ids=list(admin_ids),
                    type="system_error",
                    title=f"시스템 알림: {error_type} 실패",
                    body=(error_msg or "")[:200],
                    link_url="/system/audit",
                )
                await db.commit()
            except Exception:
                log.exception("notify_users failed for error_type=%s", error_type)
                await db.rollback()
    except Exception:
        # 알림 자체가 실패해도 상위로 전파 안 함 (best-effort)
        log.exception("_notify_scheduler_failure top-level failure error_type=%s", error_type)


async def _send_classroom_due_reminders(db: AsyncSession) -> int:
    """클래스룸 과제(assignment_ref) 마감 23~25시간 전 — 미제출 수강생에게 1회 알림.

    미제출 = CoursePostSubmission이 없거나 status가 turned_in/returned가 아닌 학생.
    발송 후 CoursePost.due_reminder_sent_at 마크 (정확히 1회).
    """
    from app.models.classroom import Course, CoursePost, CoursePostSubmission, CourseStudent
    from app.services.notification import notify_users

    now = datetime.now(timezone.utc)
    low = now + timedelta(hours=WINDOW_LOW_HOURS)
    high = now + timedelta(hours=WINDOW_HIGH_HOURS)

    posts = (await db.execute(
        select(CoursePost).where(
            CoursePost.post_type == "assignment_ref",
            CoursePost.due_date.is_not(None),
            CoursePost.due_date >= low,
            CoursePost.due_date <= high,
            CoursePost.due_reminder_sent_at.is_(None),
        )
    )).scalars().all()

    sent = 0
    for p in posts:
        course = await db.get(Course, p.course_id)
        if not course or not course.is_active:
            p.due_reminder_sent_at = now  # 비활성 강좌 — 재시도 안 함
            continue
        student_ids = set((await db.execute(
            select(CourseStudent.student_id).where(
                CourseStudent.course_id == p.course_id,
                CourseStudent.status == "active",
            )
        )).scalars().all())
        done_ids = set((await db.execute(
            select(CoursePostSubmission.student_id).where(
                CoursePostSubmission.post_id == p.id,
                CoursePostSubmission.status.in_(["turned_in", "returned"]),
            )
        )).scalars().all())
        targets = list(student_ids - done_ids)
        if targets:
            try:
                sent += await notify_users(
                    db, user_ids=targets,
                    type="classroom.assignment.due_soon",
                    title=f"[{course.name}] 과제 마감 임박: {p.title}",
                    body="마감이 24시간 안으로 다가왔습니다. 아직 제출하지 않았어요.",
                    link_url=f"/s/classroom/{p.course_id}/posts/{p.id}",
                )
            except Exception:  # noqa: BLE001
                log.warning("classroom due reminder 발송 실패 post=%s", p.id)
        p.due_reminder_sent_at = now
    return sent


async def _send_due_reminders(db: AsyncSession) -> int:
    """한 번 실행 — 발송된 알림 수 반환.

    대상 학생 = 같은 학기 active 학생 (list_assignments가 학생에게 노출하는
    기준과 동일 — 강좌 수강 여부로 거르지 않음). target_grades가 지정된 과제는
    해당 학년 학생만. 이미 제출한 학생은 제외.
    """
    from app.services.notification import notify_users

    now = datetime.now(timezone.utc)
    low = now + timedelta(hours=WINDOW_LOW_HOURS)
    high = now + timedelta(hours=WINDOW_HIGH_HOURS)

    # 윈도 안 + 아직 미발송 + 학생에게 실제 노출되는(visible·ACTIVE) 과제만
    rows = (await db.execute(
        select(Assignment).where(
            Assignment.due_date >= low,
            Assignment.due_date <= high,
            Assignment.due_reminder_sent_at.is_(None),
            Assignment.is_visible == True,  # noqa: E712
            Assignment.status == AssignmentStatus.ACTIVE,
        )
    )).scalars().all()

    if not rows:
        return 0

    total_notified = 0
    for a in rows:
        try:
            # 대상 = 같은 학기 active 학생 (SemesterEnrollment 기준).
            stq = select(SemesterEnrollment.user_id).where(
                SemesterEnrollment.semester_id == a.semester_id,
                SemesterEnrollment.role == "student",
                SemesterEnrollment.status == "active",
            )
            # target_grades 지정 시 해당 학년만 (None/빈 list면 전체 학년 대상)
            grades = [
                int(g) for g in (a.target_grades or [])
                if str(g).strip().lstrip("-").isdigit()
            ]
            if grades:
                stq = stq.where(SemesterEnrollment.grade.in_(grades))

            student_ids = list({uid for uid in (await db.execute(stq)).scalars().all() if uid})
            if not student_ids:
                # 대상 학생 없으면 mark만 (중복 발송 방지)
                a.due_reminder_sent_at = now
                continue

            # 미제출자만 (이미 제출한 학생에겐 reminder 의미 X)
            submitted_ids = set((await db.execute(
                select(AssignmentSubmission.user_id).where(
                    AssignmentSubmission.assignment_id == a.id,
                    AssignmentSubmission.user_id.in_(student_ids),
                )
            )).scalars().all())
            pending_ids = [uid for uid in student_ids if uid not in submitted_ids]

            if pending_ids:
                # 시간 표시: KST (서버 TZ가 UTC여도 한국 기준으로 표기)
                due_local = a.due_date.astimezone(_KST) if _KST else a.due_date.astimezone()
                due_str = due_local.strftime("%m/%d %H:%M")
                count = await notify_users(
                    db, user_ids=pending_ids,
                    type="assignment.due_reminder",
                    title=f"⏰ 과제 마감 임박: {a.title}",
                    body=f"[{a.subject}] 마감 {due_str}까지 약 24시간 남았습니다. 아직 제출하지 않았다면 서둘러 제출하세요.",
                    link_url="/s/assignment",
                    source_user_id=None,
                    meta={"assignment_id": a.id, "due_date": a.due_date.isoformat()},
                )
                total_notified += count

            # 마크 (중복 방지) — 미제출자 0명(전원 제출)이어도 mark
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
    """24시간에 한 번 휴지통 30일 경과 자료 hard delete + quota 환원.

    안전망:
      - `_last_purge_at` 시도 즉시 업데이트 → 예외 발생해도 다음 24h tick까지 재시도 X
        (이전엔 try 안에서 마커 업데이트 → 실패 시 무한 retry → DB 부하).
      - 실패 시 super_admin에게 알림 (24h 쿨다운).
    """
    global _last_purge_at
    now = datetime.now(timezone.utc)
    if _last_purge_at and (now - _last_purge_at) < timedelta(hours=TRASH_PURGE_INTERVAL_HOURS):
        return 0
    # 시도 즉시 마커 업데이트 — 실패해도 다음 24h tick까지 재시도 안 함 (DB 부하 차단)
    _last_purge_at = now

    try:
        from app.modules.drive.router import purge_expired_trash
        result = await purge_expired_trash(db)
        if result["deleted_total"] > 0:
            log.info(
                "[NOTIF SCHED] 휴지통 자동 purge — %d개 삭제, %d MB 환원",
                result["deleted_total"], result["freed_bytes_total"] // 1024 // 1024,
            )
        return result["deleted_total"]
    except Exception as e:
        log.exception("purge_expired_trash failed")
        # super_admin 알림 (24h 쿨다운, best-effort)
        try:
            await _notify_scheduler_failure("trash_purge", str(e))
        except Exception:
            log.exception("_notify_scheduler_failure call failed")
        return 0


async def _disable_expired_users(db: AsyncSession) -> int:
    """매 tick 만료된 임시·대리 계정 비활성화."""
    from app.modules.users.lifecycle import disable_expired_accounts
    n = await disable_expired_accounts(db)
    if n > 0:
        log.info("[NOTIF SCHED] 만료 계정 자동 비활성화 — %d명", n)
    return n


# Revision 정리 tick — 하루 1회. 문서당 최근 100 revision만 유지 + 90일 이상 일괄 삭제.
REVISION_PURGE_INTERVAL_HOURS = 24
REVISION_MAX_PER_DOC = 100
REVISION_MAX_AGE_DAYS = 90
_last_revision_purge_at: datetime | None = None


async def _maybe_purge_old_revisions(db: AsyncSession) -> int:
    """문서 revision 누적 방지 — 90일 이상 일괄 삭제 + 문서당 최근 100개만 유지.

    Hocuspocus가 매 분 snapshot → 1년이면 한 문서당 ~500k revision 가능.
    storage 폭주 차단.
    """
    global _last_revision_purge_at
    now = datetime.now(timezone.utc)
    if _last_revision_purge_at and (now - _last_revision_purge_at) < timedelta(
        hours=REVISION_PURGE_INTERVAL_HOURS,
    ):
        return 0

    from sqlalchemy import delete, select, func
    from app.models import DocumentRevision

    deleted = 0

    # 1) 90일 이상 일괄 삭제
    cutoff = now - timedelta(days=REVISION_MAX_AGE_DAYS)
    r1 = await db.execute(
        delete(DocumentRevision).where(DocumentRevision.created_at < cutoff)
    )
    deleted += r1.rowcount or 0

    # 2) 문서당 최근 100 revision만 유지 — 오래된 것 cleanup
    # PostgreSQL row_number 사용 — SQLite는 sub-query
    docs_with_many = (await db.execute(
        select(DocumentRevision.document_id, func.count())
        .group_by(DocumentRevision.document_id)
        .having(func.count() > REVISION_MAX_PER_DOC)
    )).all()
    for doc_id, total in docs_with_many:
        keep_ids = (await db.execute(
            select(DocumentRevision.id)
            .where(DocumentRevision.document_id == doc_id)
            .order_by(DocumentRevision.created_at.desc())
            .limit(REVISION_MAX_PER_DOC)
        )).scalars().all()
        if keep_ids:
            r2 = await db.execute(
                delete(DocumentRevision).where(
                    DocumentRevision.document_id == doc_id,
                    DocumentRevision.id.notin_(keep_ids),
                )
            )
            deleted += r2.rowcount or 0

    _last_revision_purge_at = now
    if deleted > 0:
        log.info("[NOTIF SCHED] revision purge — %d개 삭제", deleted)
    return deleted


# GitHub 업데이트 알림 tick — 24시간 1회.
GITHUB_UPDATE_INTERVAL_HOURS = 24
_last_github_check_at: datetime | None = None


async def _maybe_check_github_updates(db: AsyncSession) -> int:
    """24시간 1회 GitHub repo HEAD 비교 → 새 commit 있으면 super_admin 알림.

    GITHUB_UPDATE_REPO env 미설정이면 즉시 0 반환 (dev/non-prod 환경 안전).
    중복 알림 방지: SchoolConfig.last_notified_remote_sha 비교 (services/github_updates).

    returns: 발송 알림 수 (super_admin 인원). 발송 안 했으면 0.
    """
    global _last_github_check_at
    now = datetime.now(timezone.utc)
    if _last_github_check_at and (now - _last_github_check_at) < timedelta(
        hours=GITHUB_UPDATE_INTERVAL_HOURS,
    ):
        return 0
    _last_github_check_at = now

    from app.services.github_updates import check_and_notify, is_polling_enabled

    if not is_polling_enabled():
        return 0

    result = await check_and_notify(db)
    if result.get("notified"):
        log.info(
            "[NOTIF SCHED] GitHub 업데이트 알림 — %d commit behind, remote=%s",
            result.get("behind_count", 0),
            (result.get("remote") or {}).get("sha", "?")[:7],
        )
        return result.get("behind_count", 0) or 1
    return 0


# Storage Volume 사용량/헬스체크 tick — 6시간 1회.
# shutil.disk_usage 호출은 비교적 비용 있고 외장 장치 spin-up 발생 가능 → 너무 자주 X.
STORAGE_VOLUME_INTERVAL_HOURS = 6
STORAGE_VOLUME_WARN_THRESHOLD = 0.9  # 90% 도달 시 super_admin 경고
_last_volume_check_at: datetime | None = None


async def _update_storage_volumes() -> int:
    """6시간 1회 active 볼륨 사용량 + 헬스체크 자동 업데이트.

    동작:
      - shutil.disk_usage 비동기(asyncio.to_thread)로 호출
      - 모든 active 볼륨 순회 (한 볼륨 실패해도 다음 계속)
      - 경로 없으면 last_status="missing", 접근 불가/예외면 "error: ..."
      - 정상이면 last_status="mounted", used_bytes/capacity_bytes 갱신, last_checked_at 마크
      - used/capacity >= 90% 도달 시 super_admin 경고 알림 (24h 쿨다운)

    returns: 체크한 볼륨 수
    """
    global _last_volume_check_at
    now = datetime.now(timezone.utc)
    if _last_volume_check_at and (now - _last_volume_check_at) < timedelta(
        hours=STORAGE_VOLUME_INTERVAL_HOURS,
    ):
        return 0
    # 시도 즉시 마커 업데이트 — 실패해도 다음 6h tick까지 재시도 안 함 (외장 장치 spin-up 폭주 차단)
    _last_volume_check_at = now

    checked = 0
    warned: list[tuple[str, float, int, int]] = []  # (name, ratio, used, capacity)
    try:
        async with async_session_factory() as db:
            rows = (await db.execute(
                select(StorageVolume).where(StorageVolume.is_active == True)
            )).scalars().all()

            for v in rows:
                try:
                    if not v.path or not await asyncio.to_thread(
                        lambda p=v.path: Path(p).exists()
                    ):
                        v.last_status = "missing"
                        v.last_checked_at = now
                        checked += 1
                        continue

                    usage = await asyncio.to_thread(shutil.disk_usage, v.path)
                    v.used_bytes = usage.used
                    # 등록 시 0이었거나 변경된 경우만 capacity 갱신
                    if not v.capacity_bytes or v.capacity_bytes == 0:
                        v.capacity_bytes = usage.total
                    v.last_status = "mounted"
                    v.last_checked_at = now
                    checked += 1

                    # 사용량 90% 도달 시 경고 후보
                    cap = v.capacity_bytes or usage.total or 0
                    if cap > 0:
                        ratio = (v.used_bytes or 0) / cap
                        if ratio >= STORAGE_VOLUME_WARN_THRESHOLD:
                            warned.append((v.name, ratio, v.used_bytes or 0, cap))
                except Exception as e:
                    v.last_status = f"error: {str(e)[:50]}"
                    v.last_checked_at = now
                    checked += 1

            await db.commit()

        # 경고 알림 (24h 쿨다운, error_type별)
        if warned:
            for name, ratio, used, cap in warned:
                used_gb = used / 1024 / 1024 / 1024
                cap_gb = cap / 1024 / 1024 / 1024
                pct = ratio * 100
                try:
                    await _notify_scheduler_failure(
                        f"storage_volume_full:{name}",
                        f"{name}: {pct:.1f}% 사용 중 ({used_gb:.1f}/{cap_gb:.1f} GB) — /system/storage 확인",
                    )
                except Exception:
                    log.exception("storage volume warn notify failed name=%s", name)

        if checked > 0:
            log.info("[NOTIF SCHED] 스토리지 볼륨 체크 — %d개 (경고 %d개)", checked, len(warned))
    except Exception as e:
        log.exception("_update_storage_volumes top-level failure")
        try:
            await _notify_scheduler_failure("storage_volume_check", str(e))
        except Exception:
            log.exception("_notify_scheduler_failure (storage) call failed")

    return checked


async def _fail_stale_llm_grading(db: AsyncSession) -> int:
    """LLM 채점 'running' 상태로 1시간+ 지난 attempt를 'failed' 마크.

    서버 재시작·crash로 in-flight task 사라지면 grading_status='running' 영구 잔존 위험.
    매 tick(1h)에 1시간 임계 넘은 것 cleanup. 교사가 결과 페이지에서 재시도 가능.
    """
    from app.models import StudentProblemAttempt

    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    rows = (await db.execute(
        select(StudentProblemAttempt).where(
            StudentProblemAttempt.grading_status == "running",
            StudentProblemAttempt.submitted_at < cutoff,
        )
    )).scalars().all()

    failed_count = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    for a in rows:
        a.grading_status = "failed"
        meta = dict(a.llm_metadata or {})
        meta.setdefault("error", "stale running — 서버 재시작/timeout 추정 (1시간 초과)")
        meta.setdefault("graded_at", now_iso)
        a.llm_metadata = meta
        failed_count += 1

    if failed_count > 0:
        log.info("[NOTIF SCHED] stale LLM grading — %d개 failed로 마크", failed_count)
    return failed_count


async def _acquire_scheduler_lock():
    """멀티워커(gunicorn)에서 스케줄러를 1개 워커만 실행하기 위한 Postgres advisory lock.

    gunicorn은 워커마다 lifespan을 실행 → 스케줄러가 워커 수만큼 중복 기동된다.
    그러면 마감 reminder가 학생에게 N번 중복 발송되고, github_update_check 등은
    같은 row를 동시 INSERT해 unique 충돌이 난다. advisory lock으로 1개만 통과시킨다.

    반환:
      - None       : SQLite(dev, 단일 프로세스) 또는 lock 시도 예외 → 가드 없이 실행
      - connection : lock 획득 성공 (close 전까지 lock 유지되므로 호출측이 보관)
      - _LOCK_SKIP : 다른 워커가 이미 보유 → 호출측은 cron 돌리지 말고 return
    """
    if is_sqlite:
        return None
    try:
        conn = await engine.connect()
    except Exception as e:
        log.warning("[NOTIF SCHED] lock connection 실패(%s) — 가드 없이 실행", e)
        return None
    try:
        res = await conn.execute(
            text("SELECT pg_try_advisory_lock(:k)"), {"k": SCHEDULER_LOCK_KEY}
        )
        got = bool(res.scalar())
    except Exception as e:
        log.warning("[NOTIF SCHED] advisory lock 시도 실패(%s) — 가드 없이 실행", e)
        try:
            await conn.close()
        except Exception:
            pass
        return None
    if not got:
        try:
            await conn.close()
        except Exception:
            pass
        return _LOCK_SKIP
    log.info("[NOTIF SCHED] advisory lock 획득 — 이 워커가 단독으로 cron 실행")
    return conn


async def _scheduler_loop() -> None:
    """무한 루프 — 1시간마다 tick.

    각 cron task는 **독립 session + 독립 try/except**로 격리. 하나 실패해도
    다른 task까지 트랜잭션 abort(`InFailedSQLTransactionError`)로 줄줄이 죽는
    회귀를 차단 (2026-05-22 발견: 모델/DB schema mismatch가 _maybe_purge_trash
    한 곳에서 발생 → 같은 session 안의 후속 _disable_expired_users 등 모두 실패).

    멀티워커: advisory lock으로 1개 워커만 실제 cron을 돌린다 (중복 발송·unique 충돌 차단).
    """
    log.info("[NOTIF SCHED] 시작 (tick %ds, window %d~%dh)",
             TICK_SECONDS, WINDOW_LOW_HOURS, WINDOW_HIGH_HOURS)
    # 첫 tick은 30초 후 (startup race 회피)
    await asyncio.sleep(30)

    # 멀티워커 singleton 가드 — 1개 워커만 통과
    lock = await _acquire_scheduler_lock()
    if lock is _LOCK_SKIP:
        log.info("[NOTIF SCHED] 다른 워커가 스케줄러 보유 중 — 이 워커는 cron skip")
        return
    lock_conn = lock  # None(가드 미적용) 또는 보유 connection

    # task_name → (callable, log_on_success_or_None)
    # callable은 (db) 받아서 결과(int) 반환 — 성공 시 main loop에서 commit.
    tasks = [
        ("due_reminders", _send_due_reminders,
         lambda n: f"마감 임박 reminder {n}건 발송" if n > 0 else ""),
        ("classroom_due_reminders", _send_classroom_due_reminders,
         lambda n: f"클래스룸 과제 마감 reminder {n}건 발송" if n > 0 else ""),
        ("trash_purge", _maybe_purge_trash, None),  # 내부에서 log
        ("expired_users", _disable_expired_users, None),  # 내부에서 log
        ("revision_purge", _maybe_purge_old_revisions, None),  # 내부에서 log
        ("github_update_check", _maybe_check_github_updates, None),  # 내부에서 log
        ("stale_llm_grading", _fail_stale_llm_grading, None),  # 내부에서 log
    ]

    try:
        while True:
            try:
                for task_name, task_fn, log_fn in tasks:
                    # **task별 독립 session** — 하나 실패해도 다른 task 영향 X
                    try:
                        async with async_session_factory() as db:
                            try:
                                result = await task_fn(db)
                                await db.commit()
                                if log_fn:
                                    msg = log_fn(result if isinstance(result, int) else 0)
                                    if msg:
                                        log.info("[NOTIF SCHED] %s", msg)
                            except Exception:
                                await db.rollback()
                                raise
                    except Exception as e:
                        log.warning("[NOTIF SCHED] %s failed: %s", task_name, e)
                        # task별 error_type → 24h 쿨다운 별개 (한 task가 죽으면
                        # 그것만 24h 알림, 다른 task는 정상)
                        try:
                            await _notify_scheduler_failure(
                                f"notification_scheduler_{task_name}", str(e),
                            )
                        except Exception:
                            log.exception("_notify_scheduler_failure call failed")

                # 스토리지 볼륨 사용량/헬스체크 — 자체 session + 6h 쿨다운
                try:
                    await _update_storage_volumes()
                except Exception:
                    log.exception("[NOTIF SCHED] _update_storage_volumes outer failure")
            except asyncio.CancelledError:
                log.info("[NOTIF SCHED] 정상 종료")
                raise
            except Exception as e:
                log.warning("[NOTIF SCHED] 루프 예외 (계속 실행): %s", e)
                try:
                    await _notify_scheduler_failure("notification_scheduler_loop", str(e))
                except Exception:
                    log.exception("_notify_scheduler_failure (loop) call failed")
            await asyncio.sleep(TICK_SECONDS)
    finally:
        # advisory lock 해제 (정상 종료·취소·예외 모두) — connection close = unlock
        if lock_conn is not None:
            try:
                await lock_conn.close()
            except Exception:
                pass


def start_scheduler() -> asyncio.Task:
    """lifespan에서 호출. asyncio.Task 반환."""
    return asyncio.create_task(_scheduler_loop(), name="notification_scheduler")
