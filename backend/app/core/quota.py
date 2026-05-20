"""드라이브 quota — 개인 도구 자료(협업 문서/시트/덱/설문)에만 차감.

설계 원칙:
  - 클래스룸 첨부·학생 산출물·과제 제출은 학교 공통 (quota 무관) — 보존 정책상.
  - super_admin은 무제한 (quota_bytes=0 = 무제한 sentinel).
  - 단일 파일 한도 50MB (FILE_SIZE_LIMIT).
  - 80% 도달 시 1일 1회 알림 (quota_warning type, 24h 쿨다운).
  - 휴지통 자료는 여전히 used_bytes에 포함 (30일 보호 기간 = quota 차감).

사용 패턴:
  - 생성 시: check_quota(user, size) → DB insert → consume_quota(db, user, size)
  - 업데이트 시: adjust_quota(db, user, old_bytes=old, new_bytes=new)
  - 삭제 시 (soft): 그대로 유지 (휴지통에 있음 = quota 차감)
  - 영구 삭제 시: release_quota(db, user, doc.storage_bytes)
  - 복구 시: 휴지통에서 복구해도 quota 변화 없음 (이미 차감 중)
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, User
from app.services.notification import notify_users


# 역할별 기본 quota (bytes). 마이그레이션의 DEFAULT_QUOTA_SQL과 동일 값.
DEFAULT_QUOTA_BY_ROLE: dict[str, int] = {
    "super_admin": 0,  # 0 = 무제한 sentinel
    "designated_admin": 1000 * 1024 * 1024,
    "teacher": 500 * 1024 * 1024,
    "staff": 300 * 1024 * 1024,
    "student": 200 * 1024 * 1024,
}

# 시간강사·임시 부담임 quota
TEMPORARY_QUOTA = 50 * 1024 * 1024

# 단일 파일 한도
FILE_SIZE_LIMIT = 50 * 1024 * 1024

# 사용률 알림 임계값 (0~1)
QUOTA_WARNING_THRESHOLD = 0.8

# 동일 알림 재발송 방지 간격 (시간)
QUOTA_WARNING_COOLDOWN_HOURS = 24


def is_unlimited(user: User) -> bool:
    """무제한 quota 여부 (super_admin 또는 quota_bytes=0)."""
    return user.role == "super_admin" or (user.quota_bytes or 0) == 0


def default_quota_for(role: str, user_type: str = "regular") -> int:
    """역할 + user_type 기반 기본 quota 산정."""
    if user_type in ("temporary", "substitute"):
        return TEMPORARY_QUOTA
    return DEFAULT_QUOTA_BY_ROLE.get(role, 200 * 1024 * 1024)


def check_quota(user: User, additional_bytes: int) -> None:
    """추가 사용량이 quota를 넘으면 HTTPException(413).

    raises:
      - 413 FILE_TOO_LARGE — 단일 파일 한도 초과
      - 413 QUOTA_EXCEEDED — 누적 quota 초과
    """
    if additional_bytes is None or additional_bytes < 0:
        return
    if additional_bytes > FILE_SIZE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "FILE_TOO_LARGE",
                "message": f"단일 파일은 {FILE_SIZE_LIMIT // 1024 // 1024}MB까지입니다.",
                "limit_bytes": FILE_SIZE_LIMIT,
            },
        )
    if is_unlimited(user):
        return
    available = max(0, (user.quota_bytes or 0) - (user.used_bytes or 0))
    if additional_bytes > available:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "QUOTA_EXCEEDED",
                "message": "드라이브 용량이 부족합니다. 휴지통을 정리하거나 관리자에게 용량 증설을 요청하세요.",
                "quota_bytes": user.quota_bytes,
                "used_bytes": user.used_bytes,
                "additional_bytes": additional_bytes,
            },
        )


async def consume_quota(
    db: AsyncSession,
    user: User,
    bytes_used: int,
    *,
    check: bool = True,
    notify_threshold: bool = True,
) -> None:
    """사용량 추가. check=True면 quota 검증 후 차감, False면 강제 차감 (관리자 작업 등)."""
    if bytes_used is None or bytes_used <= 0:
        return
    if check:
        check_quota(user, bytes_used)
    user.used_bytes = (user.used_bytes or 0) + bytes_used
    await db.flush()
    if notify_threshold and not is_unlimited(user):
        await _maybe_warn(db, user)


async def release_quota(db: AsyncSession, user: User, bytes_freed: int) -> None:
    """사용량 감소 (음수 방지)."""
    if bytes_freed is None or bytes_freed <= 0:
        return
    user.used_bytes = max(0, (user.used_bytes or 0) - bytes_freed)
    await db.flush()


async def adjust_quota(
    db: AsyncSession,
    user: User,
    *,
    old_bytes: int,
    new_bytes: int,
) -> None:
    """협업 문서 등의 storage_bytes가 변할 때 delta로 조정."""
    delta = (new_bytes or 0) - (old_bytes or 0)
    if delta > 0:
        await consume_quota(db, user, delta)
    elif delta < 0:
        await release_quota(db, user, -delta)


async def _maybe_warn(db: AsyncSession, user: User) -> None:
    """80% 도달 시 알림 (24h 쿨다운)."""
    quota = user.quota_bytes or 0
    used = user.used_bytes or 0
    if quota <= 0:
        return
    if used / quota < QUOTA_WARNING_THRESHOLD:
        return
    # 최근 24시간 내 quota_warning 알림 있으면 skip
    cutoff = datetime.now(timezone.utc) - timedelta(hours=QUOTA_WARNING_COOLDOWN_HOURS)
    recent = (
        await db.execute(
            select(Notification.id)
            .where(
                Notification.user_id == user.id,
                Notification.type == "quota_warning",
                Notification.created_at >= cutoff,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if recent:
        return
    used_mb = used // 1024 // 1024
    quota_mb = quota // 1024 // 1024
    percent = int(used / quota * 100)
    await notify_users(
        db,
        user_ids=[user.id],
        type="quota_warning",
        title=f"드라이브 용량 {percent}% 사용 중",
        body=f"{used_mb}MB / {quota_mb}MB 사용. 부족하면 휴지통을 비우거나 구글 드라이브에 백업하세요.",
        link_url="/drive",
    )


def assign_default_quota(user: User) -> None:
    """계정 생성 hook — 역할별 기본 quota 자동 부여.

    이미 quota_bytes가 양수면 건너뜀 (관리자가 미리 지정한 경우 존중).
    super_admin은 무제한이므로 0으로 유지.
    """
    if user.quota_bytes and user.quota_bytes > 0:
        return
    if user.role == "super_admin":
        user.quota_bytes = 0
        return
    user.quota_bytes = default_quota_for(user.role, user.user_type or "regular")
