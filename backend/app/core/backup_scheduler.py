"""자동 백업 스케줄러.

학교 운영에서 가장 중요한 것 중 하나 — 데이터 손실 방지.
backend 프로세스 안에서 백그라운드 task로 주기적으로 export_all 실행.

설계:
- Setting 기반 (학교가 UI에서 조정 가능)
- enabled=False면 task는 살아있지만 아무것도 안 함
- enabled=True면 매 N시간마다 export_all → backend/storage/auto-backups/에 저장
- retention_count 초과하면 오래된 파일 자동 삭제
- last_run_at / last_status로 상태 추적

실패 처리:
- export 실패해도 task 자체는 죽지 않음 (다음 주기에 재시도)
- last_status='error' + last_error_message 기록

운영 가이드:
- backend가 24/7 떠 있어야 함 (Mac mini / NUC 권장)
- output_dir을 외장 SSD나 네트워크 드라이브 마운트 경로로 지정 가능
"""

import asyncio
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# 동시 백업 실행 lock — 스케줄러와 수동 트리거가 동시에 실행되는 것 방지.
# 같은 파일명 충돌 + DB lock 경합 + 디스크 IO 폭주 방지.
_BACKUP_LOCK = asyncio.Lock()

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.setting import Setting
from app.services.backup import export_all


BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_BACKUP_DIR = BACKEND_DIR / "storage" / "auto-backups"

SETTING_KEYS = {
    "enabled": "backup.schedule.enabled",
    "interval_hours": "backup.schedule.interval_hours",
    "retention_count": "backup.schedule.retention_count",
    "output_dir": "backup.schedule.output_dir",
    "last_run_at": "backup.schedule.last_run_at",
    "last_status": "backup.schedule.last_status",
    "last_size_bytes": "backup.schedule.last_size_bytes",
    "last_error": "backup.schedule.last_error",
    "last_filename": "backup.schedule.last_filename",
}

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "interval_hours": 24,
    "retention_count": 7,
    "output_dir": str(DEFAULT_BACKUP_DIR),
}

# 스케줄러 깨우는 주기 (초) — config 변경 즉시 반영을 위해 짧게
TICK_SECONDS = 60


async def _get(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    return row.value if row else None


async def _set(db: AsyncSession, key: str, value: str | None) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


async def get_config(db: AsyncSession) -> dict:
    """현재 스케줄 설정 + 상태."""
    enabled_raw = await _get(db, SETTING_KEYS["enabled"])
    enabled = (enabled_raw or "").lower() in ("true", "1", "yes")

    interval_raw = await _get(db, SETTING_KEYS["interval_hours"])
    try:
        interval = int(interval_raw) if interval_raw else DEFAULTS["interval_hours"]
    except ValueError:
        interval = DEFAULTS["interval_hours"]
    interval = max(1, min(interval, 24 * 30))  # 1시간 ~ 30일

    retention_raw = await _get(db, SETTING_KEYS["retention_count"])
    try:
        retention = int(retention_raw) if retention_raw else DEFAULTS["retention_count"]
    except ValueError:
        retention = DEFAULTS["retention_count"]
    retention = max(1, min(retention, 365))

    output_dir = await _get(db, SETTING_KEYS["output_dir"]) or DEFAULTS["output_dir"]

    last_run_raw = await _get(db, SETTING_KEYS["last_run_at"])
    last_run: datetime | None = None
    if last_run_raw:
        try:
            last_run = datetime.fromisoformat(last_run_raw)
        except ValueError:
            last_run = None
    last_status = await _get(db, SETTING_KEYS["last_status"])
    last_error = await _get(db, SETTING_KEYS["last_error"])
    last_size_raw = await _get(db, SETTING_KEYS["last_size_bytes"])
    try:
        last_size = int(last_size_raw) if last_size_raw else None
    except ValueError:
        last_size = None
    last_filename = await _get(db, SETTING_KEYS["last_filename"])

    return {
        "enabled": enabled,
        "interval_hours": interval,
        "retention_count": retention,
        "output_dir": output_dir,
        "last_run_at": last_run.isoformat() if last_run else None,
        "last_status": last_status,
        "last_error": last_error,
        "last_size_bytes": last_size,
        "last_filename": last_filename,
    }


async def set_config(db: AsyncSession, patch: dict) -> dict:
    """설정 부분 업데이트. None은 보존."""
    if "enabled" in patch:
        await _set(db, SETTING_KEYS["enabled"], "true" if patch["enabled"] else "false")
    if "interval_hours" in patch and patch["interval_hours"] is not None:
        v = int(patch["interval_hours"])
        if v < 1 or v > 24 * 30:
            raise ValueError("interval_hours 범위: 1 ~ 720")
        await _set(db, SETTING_KEYS["interval_hours"], str(v))
    if "retention_count" in patch and patch["retention_count"] is not None:
        v = int(patch["retention_count"])
        if v < 1 or v > 365:
            raise ValueError("retention_count 범위: 1 ~ 365")
        await _set(db, SETTING_KEYS["retention_count"], str(v))
    if "output_dir" in patch and patch["output_dir"] is not None:
        path = str(patch["output_dir"]).strip()
        if not path:
            raise ValueError("output_dir 비어있음")
        # 보안: 절대경로 + 경로 traversal 검증은 미흡할 수 있음 — super_admin 전용이라 신뢰
        await _set(db, SETTING_KEYS["output_dir"], path)
    await db.flush()
    return await get_config(db)


_FILENAME_RE = re.compile(r"^auto-backup-(\d{8})-(\d{6})\.zip$")


def _is_backup_file(name: str) -> bool:
    return bool(_FILENAME_RE.match(name))


def _list_backups(output_dir: Path) -> list[dict]:
    """output_dir의 백업 파일 목록 (최신순)."""
    if not output_dir.exists():
        return []
    items = []
    for p in output_dir.iterdir():
        if p.is_file() and _is_backup_file(p.name):
            stat = p.stat()
            items.append({
                "filename": p.name,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "path": str(p),
            })
    items.sort(key=lambda x: x["modified_at"], reverse=True)
    return items


async def list_backups(db: AsyncSession) -> list[dict]:
    config = await get_config(db)
    return _list_backups(Path(config["output_dir"]))


async def run_backup_now(db: AsyncSession) -> dict:
    """즉시 한 번 export + retention 정리. 결과 dict 반환.

    _BACKUP_LOCK으로 동시 실행 차단 — 같은 파일명 충돌 + DB 락 경합 방지.
    다른 백업이 진행 중이면 RuntimeError.
    """
    if _BACKUP_LOCK.locked():
        raise RuntimeError("다른 백업이 이미 진행 중입니다. 잠시 후 다시 시도하세요.")
    async with _BACKUP_LOCK:
        return await _run_backup_now_locked(db)


async def _run_backup_now_locked(db: AsyncSession) -> dict:
    """실제 백업 실행 (lock 안에서 호출)."""
    config = await get_config(db)
    out_dir = Path(config["output_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"auto-backup-{timestamp}.zip"
    target = out_dir / filename

    try:
        zip_bytes = await export_all(db)
        target.write_bytes(zip_bytes)
        size = len(zip_bytes)
    except Exception as e:
        await _set(db, SETTING_KEYS["last_status"], "error")
        await _set(db, SETTING_KEYS["last_error"], str(e)[:500])
        await _set(db, SETTING_KEYS["last_run_at"], datetime.now(timezone.utc).isoformat())
        await db.flush()
        raise

    # retention: 오래된 파일 정리
    items = _list_backups(out_dir)
    excess = items[config["retention_count"]:]
    deleted = 0
    for ex in excess:
        try:
            os.remove(ex["path"])
            deleted += 1
        except OSError:
            pass

    await _set(db, SETTING_KEYS["last_status"], "success")
    await _set(db, SETTING_KEYS["last_error"], None)
    await _set(db, SETTING_KEYS["last_run_at"], datetime.now(timezone.utc).isoformat())
    await _set(db, SETTING_KEYS["last_size_bytes"], str(size))
    await _set(db, SETTING_KEYS["last_filename"], filename)
    await db.flush()

    return {
        "filename": filename,
        "size_bytes": size,
        "deleted_old": deleted,
        "path": str(target),
    }


async def _scheduler_loop() -> None:
    """무한 루프 — TICK_SECONDS마다 체크해서 시간 됐으면 backup 실행."""
    print(f"[BACKUP SCHED] 시작 (tick {TICK_SECONDS}s)")
    while True:
        try:
            async with async_session_factory() as db:
                config = await get_config(db)
                if config["enabled"]:
                    now = datetime.now(timezone.utc)
                    last_run_str = config.get("last_run_at")
                    last_run = None
                    if last_run_str:
                        try:
                            last_run = datetime.fromisoformat(last_run_str)
                            if last_run.tzinfo is None:
                                last_run = last_run.replace(tzinfo=timezone.utc)
                        except ValueError:
                            last_run = None

                    interval_seconds = config["interval_hours"] * 3600
                    if not last_run or (now - last_run).total_seconds() >= interval_seconds:
                        try:
                            print(f"[BACKUP SCHED] 백업 실행 시작...")
                            result = await run_backup_now(db)
                            await db.commit()
                            print(f"[BACKUP SCHED] 백업 완료: {result['filename']} ({result['size_bytes']:,} bytes)")
                        except Exception as e:
                            await db.rollback()
                            print(f"[BACKUP SCHED] 백업 실패: {e}")
                            try:
                                async with async_session_factory() as db2:
                                    await _set(db2, SETTING_KEYS["last_status"], "error")
                                    await _set(db2, SETTING_KEYS["last_error"], str(e)[:500])
                                    await db2.commit()
                            except Exception:
                                pass
        except asyncio.CancelledError:
            print("[BACKUP SCHED] 정상 종료")
            raise
        except Exception as e:
            # task가 죽지 않도록 모든 예외 흡수
            print(f"[BACKUP SCHED] 루프 예외 (계속 실행): {e}")
        await asyncio.sleep(TICK_SECONDS)


def start_scheduler() -> asyncio.Task:
    """lifespan에서 호출. asyncio.Task 반환."""
    return asyncio.create_task(_scheduler_loop(), name="backup_scheduler")
