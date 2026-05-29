"""Lock 파일 관리 — 동시 실행 차단.

`/tmp/gs-update.lock` 파일 존재로 진행 중 표시.
10분 이상 오래된 lock은 죽은 프로세스로 간주 → 자동 회수.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)


LOCK_FILE = Path("/tmp/gs-update.lock")
STALE_TIMEOUT_SEC = 600  # 10분


def acquire() -> bool:
    """Lock 획득. 이미 있고 stale 아니면 False."""
    try:
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(
            fd,
            f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n".encode(),
        )
        os.close(fd)
        return True
    except FileExistsError:
        # stale 검사
        try:
            mtime = LOCK_FILE.stat().st_mtime
            if time.time() - mtime > STALE_TIMEOUT_SEC:
                log.warning("update.lock: stale lock removed (>%ds old)", STALE_TIMEOUT_SEC)
                LOCK_FILE.unlink(missing_ok=True)
                return acquire()
        except FileNotFoundError:
            return acquire()
        return False


def release() -> None:
    """Lock 해제 (idempotent)."""
    LOCK_FILE.unlink(missing_ok=True)


def is_running() -> bool:
    """진행 중 여부."""
    return LOCK_FILE.exists()
