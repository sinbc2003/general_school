"""audit_log retention 정책.

장기 운영 시 audit_logs 테이블이 수십만~수백만 행 누적되면:
- 백업 ZIP 크기/속도 영향
- 권한 변경 이력 timeline 페이지 느려짐
- DB 디스크 비대

정책:
- Setting 키 'audit.retention_days' (기본 365일)
- 'audit.retention_keep_sensitive_days' (기본 1825일 = 5년 — 민감 이벤트는 더 길게)
- 자동 정리: backup_scheduler와 비슷한 백그라운드 task (매일 새벽 1회)
- 수동 정리: scripts/cleanup_audit_logs.py

운영자가 settings에서 조정 가능.
"""

from datetime import datetime, timezone, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.setting import Setting


SETTING_KEYS = {
    "retention_days": "audit.retention_days",
    "retention_keep_sensitive_days": "audit.retention_keep_sensitive_days",
    "last_cleanup_at": "audit.last_cleanup_at",
    "last_cleanup_deleted": "audit.last_cleanup_deleted",
}

DEFAULTS = {
    "retention_days": 365,
    "retention_keep_sensitive_days": 1825,  # 5년
}


async def _get(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return row.value if row else None


async def _set(db: AsyncSession, key: str, value: str | None) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


async def get_retention_config(db: AsyncSession) -> dict:
    """현재 retention 설정 + 상태."""
    def _int(raw: str | None, default: int) -> int:
        try:
            return int(raw) if raw else default
        except ValueError:
            return default

    retention = _int(await _get(db, SETTING_KEYS["retention_days"]), DEFAULTS["retention_days"])
    sensitive = _int(await _get(db, SETTING_KEYS["retention_keep_sensitive_days"]), DEFAULTS["retention_keep_sensitive_days"])
    last_at = await _get(db, SETTING_KEYS["last_cleanup_at"])
    last_deleted = _int(await _get(db, SETTING_KEYS["last_cleanup_deleted"]), 0)

    return {
        "retention_days": max(30, min(retention, 365 * 10)),  # 30일~10년 클램프
        "retention_keep_sensitive_days": max(30, min(sensitive, 365 * 20)),
        "last_cleanup_at": last_at,
        "last_cleanup_deleted": last_deleted,
    }


async def set_retention_config(db: AsyncSession, patch: dict) -> dict:
    """설정 부분 수정. 정상값 검증."""
    if "retention_days" in patch and patch["retention_days"] is not None:
        v = int(patch["retention_days"])
        if v < 30 or v > 365 * 10:
            raise ValueError("retention_days 범위: 30 ~ 3650")
        await _set(db, SETTING_KEYS["retention_days"], str(v))
    if "retention_keep_sensitive_days" in patch and patch["retention_keep_sensitive_days"] is not None:
        v = int(patch["retention_keep_sensitive_days"])
        if v < 30 or v > 365 * 20:
            raise ValueError("retention_keep_sensitive_days 범위: 30 ~ 7300")
        await _set(db, SETTING_KEYS["retention_keep_sensitive_days"], str(v))
    await db.flush()
    return await get_retention_config(db)


async def cleanup_audit_logs(db: AsyncSession) -> dict:
    """retention 정책에 따라 오래된 audit_log 삭제.

    is_sensitive=True 행은 retention_keep_sensitive_days 적용.
    is_sensitive=False 행은 retention_days 적용.
    """
    config = await get_retention_config(db)
    now = datetime.now(timezone.utc)

    normal_cutoff = now - timedelta(days=config["retention_days"])
    sensitive_cutoff = now - timedelta(days=config["retention_keep_sensitive_days"])

    # 일반 로그 삭제
    normal_result = await db.execute(
        delete(AuditLog).where(
            AuditLog.is_sensitive == False,  # noqa: E712
            AuditLog.timestamp < normal_cutoff,
        )
    )
    normal_deleted = normal_result.rowcount or 0

    # 민감 로그 삭제 (더 긴 보존)
    sensitive_result = await db.execute(
        delete(AuditLog).where(
            AuditLog.is_sensitive == True,  # noqa: E712
            AuditLog.timestamp < sensitive_cutoff,
        )
    )
    sensitive_deleted = sensitive_result.rowcount or 0

    total = normal_deleted + sensitive_deleted
    await _set(db, SETTING_KEYS["last_cleanup_at"], now.isoformat())
    await _set(db, SETTING_KEYS["last_cleanup_deleted"], str(total))
    await db.flush()

    return {
        "deleted_normal": normal_deleted,
        "deleted_sensitive": sensitive_deleted,
        "total": total,
        "normal_cutoff": normal_cutoff.isoformat(),
        "sensitive_cutoff": sensitive_cutoff.isoformat(),
    }
