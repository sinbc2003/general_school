"""asyncio.subprocess 헬퍼 + health check.

업데이트 실행기의 모든 외부 명령 실행은 여기서.
타임아웃 + 출력 캡처 + 일관된 dict 반환.
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import httpx


HEALTH_CHECK_URL = "http://localhost/api/health"
HEALTH_CHECK_TIMEOUT_SEC = 60
HEALTH_POLL_INTERVAL_SEC = 2

# 단계별 기본 timeout (초). overrides는 호출자가.
DEFAULT_STEP_TIMEOUT_SEC = {
    "backup": 300,
    "git_pull": 60,
    "pip_install": 300,
    "alembic": 120,
    "npm_install": 600,
    "npm_build": 600,
    "hocuspocus": 300,
    "restart": 30,
    "health": HEALTH_CHECK_TIMEOUT_SEC,
}


async def run(
    name: str,
    cmd: list[str],
    cwd: Path | str,
    timeout: int | None = None,
) -> dict:
    """subprocess 실행 + dict 반환.

    Returns:
        {ok: bool, stdout: str, stderr: str, returncode: int, took_sec: float}

    stdout/stderr는 마지막 4000자만 (UI에 표시되는 게 길지 않게).
    """
    start = time.monotonic()
    timeout = timeout or DEFAULT_STEP_TIMEOUT_SEC.get(name, 120)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=str(cwd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "DEBIAN_FRONTEND": "noninteractive"},
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {
                "ok": False, "stdout": "", "stderr": f"timeout after {timeout}s",
                "returncode": -1, "took_sec": round(time.monotonic() - start, 1),
            }
        return {
            "ok": proc.returncode == 0,
            "stdout": (stdout or b"").decode("utf-8", errors="replace")[-4000:],
            "stderr": (stderr or b"").decode("utf-8", errors="replace")[-4000:],
            "returncode": proc.returncode,
            "took_sec": round(time.monotonic() - start, 1),
        }
    except FileNotFoundError as exc:
        return {
            "ok": False, "stdout": "", "stderr": f"command not found: {exc}",
            "returncode": -2, "took_sec": round(time.monotonic() - start, 1),
        }


async def health_check(
    url: str = HEALTH_CHECK_URL,
    timeout: int = HEALTH_CHECK_TIMEOUT_SEC,
) -> bool:
    """/api/health가 200 OK + status=ok 응답할 때까지 polling."""
    deadline = time.monotonic() + timeout
    async with httpx.AsyncClient(timeout=5.0) as client:
        while time.monotonic() < deadline:
            try:
                r = await client.get(url)
                if r.status_code == 200 and r.json().get("status") == "ok":
                    return True
            except Exception:
                pass
            await asyncio.sleep(HEALTH_POLL_INTERVAL_SEC)
    return False


def detect_install_dir() -> Path:
    """현재 코드의 git repo 루트 (scripts/ 포함된 디렉터리)."""
    here = Path(__file__).resolve()
    for p in here.parents:
        if (p / ".git").exists() and (p / "scripts").is_dir():
            return p
    return here.parents[4]
