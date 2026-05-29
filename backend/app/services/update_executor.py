"""GitHub 업데이트 자동 적용 + 실패 시 rollback.

super_admin이 UI 버튼 클릭하면 9단계 실행:
  0. lock 획득 (동시 실행 차단)
  1. 백업 (pg_dump + storage tar.gz)
  2. git fetch + 현재 SHA 저장
  3. git pull origin main
  4. backend pip install -r requirements.txt
  5. alembic upgrade head (DB 스키마)
  6. frontend npm ci --legacy-peer-deps + npm run build
  7. (backend-hocuspocus 있으면) npm ci + build
  8. systemctl restart gs-backend gs-frontend gs-hocuspocus
  9. health check (/api/health, 60초 안에 200 OK)

실패 시 자동 rollback:
  - git reset --hard <from_sha>
  - pg_restore <backup>
  - systemctl restart
  - 실패 알림

진행 상황은 SchoolConfig['system.update.progress']에 JSON 저장 →
frontend가 polling으로 표시.

설계:
  - 백그라운드 asyncio task (FastAPI BackgroundTasks 또는 asyncio.create_task)
  - 단계마다 progress dict 갱신
  - 마지막 실행 결과는 SchoolConfig['system.update.last_result']에 보존
  - lock 파일 /tmp/gs-update.lock (다른 프로세스가 동시 실행 차단)

권한: system.updates.apply (2FA + sensitive). audit log 필수.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SchoolConfig

log = logging.getLogger(__name__)


LOCK_FILE = Path("/tmp/gs-update.lock")
PROGRESS_KEY = "system.update.progress"
LAST_RESULT_KEY = "system.update.last_result"
BACKUP_DIR_DEFAULT = Path("/tmp/gs-update-backups")
HEALTH_CHECK_URL = "http://localhost/api/health"
HEALTH_CHECK_TIMEOUT_SEC = 60
STEP_TIMEOUT_SEC = {
    "backup": 300,        # 5분 (DB 큰 경우 대비)
    "git_pull": 60,
    "pip_install": 300,
    "alembic": 120,
    "npm_install": 600,   # 10분 (frontend 무거움)
    "npm_build": 600,
    "hocuspocus": 300,
    "restart": 30,
    "health": HEALTH_CHECK_TIMEOUT_SEC,
}


# ── 진행 상황 저장/조회 ──

async def _get_config_value(db: AsyncSession, key: str) -> dict | None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    if not row or not row.value:
        return None
    try:
        return json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return None


async def _set_config_value(db: AsyncSession, key: str, value: dict) -> None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    payload = json.dumps(value, ensure_ascii=False, default=str)
    if row:
        row.value = payload
    else:
        row = SchoolConfig(key=key, value=payload)
        db.add(row)
    await db.flush()


async def get_progress(db: AsyncSession) -> dict | None:
    """진행 중인 업데이트 상태 (frontend가 polling)."""
    return await _get_config_value(db, PROGRESS_KEY)


async def get_last_result(db: AsyncSession) -> dict | None:
    """마지막 업데이트 실행 결과."""
    return await _get_config_value(db, LAST_RESULT_KEY)


# ── lock (동시 실행 차단) ──

def _acquire_lock() -> bool:
    """lock 획득. 다른 프로세스가 이미 실행 중이면 False."""
    try:
        # O_EXCL — 이미 있으면 실패
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n".encode())
        os.close(fd)
        return True
    except FileExistsError:
        # stale lock (10분 이상 오래된 lock은 무효 — 죽은 프로세스)
        try:
            mtime = LOCK_FILE.stat().st_mtime
            if time.time() - mtime > 600:
                log.warning("update_executor: stale lock removed (>10min old)")
                LOCK_FILE.unlink(missing_ok=True)
                return _acquire_lock()
        except FileNotFoundError:
            return _acquire_lock()
        return False


def _release_lock() -> None:
    LOCK_FILE.unlink(missing_ok=True)


def is_running() -> bool:
    return LOCK_FILE.exists()


# ── 단계 실행 헬퍼 ──

async def _run_step(name: str, cmd: list[str], cwd: Path,
                    timeout: int | None = None) -> dict:
    """subprocess 실행 + 결과 dict 반환. (asyncio.subprocess 사용 — 비차단).

    Returns:
        {ok: bool, stdout: str, stderr: str, returncode: int, took_sec: float}
    """
    start = time.monotonic()
    timeout = timeout or STEP_TIMEOUT_SEC.get(name, 120)
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
                "ok": False,
                "stdout": "",
                "stderr": f"timeout after {timeout}s",
                "returncode": -1,
                "took_sec": round(time.monotonic() - start, 1),
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


async def _health_check(timeout: int = HEALTH_CHECK_TIMEOUT_SEC) -> bool:
    """/api/health가 200 OK 응답할 때까지 polling."""
    deadline = time.monotonic() + timeout
    async with httpx.AsyncClient(timeout=5.0) as client:
        while time.monotonic() < deadline:
            try:
                r = await client.get(HEALTH_CHECK_URL)
                if r.status_code == 200 and r.json().get("status") == "ok":
                    return True
            except Exception:
                pass
            await asyncio.sleep(2)
    return False


def _detect_install_dir() -> Path:
    """현재 코드의 git repo 루트."""
    here = Path(__file__).resolve()
    # backend/app/services/update_executor.py → backend/app/services → ... → install_dir
    for p in here.parents:
        if (p / ".git").exists() and (p / "scripts").is_dir():
            return p
    # fallback
    return here.parents[3]


# ── 메인 실행 함수 ──

async def apply_update(
    db: AsyncSession,
    *,
    user_id: int,
    dry_run: bool = False,
) -> dict:
    """업데이트 실행. 백그라운드에서 호출. 진행 상황을 SchoolConfig에 저장.

    Args:
        db: 활성 AsyncSession.
        user_id: 시작한 사용자 ID (audit/로그용).
        dry_run: True면 백업만 + 미리보기 (실제 적용 X).

    Returns:
        최종 결과 dict (성공/실패/단계별 결과).
    """
    if not _acquire_lock():
        return {"ok": False, "error": "이미 진행 중인 업데이트가 있습니다", "phase": "lock"}

    install_dir = _detect_install_dir()
    backup_dir = BACKUP_DIR_DEFAULT
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"gs-pre-update-{ts}.tar.gz"
    db_backup_path = backup_dir / f"gs-pre-update-{ts}.sql.gz"

    started_at = datetime.now(timezone.utc).isoformat()
    progress: dict[str, Any] = {
        "running": True,
        "started_at": started_at,
        "started_by_user_id": user_id,
        "dry_run": dry_run,
        "from_commit": None,
        "to_commit": None,
        "backup_path": str(backup_path),
        "db_backup_path": str(db_backup_path),
        "current_step": "init",
        "steps": [],
    }

    async def _push(step_name: str, result: dict, *, is_last: bool = False) -> None:
        progress["current_step"] = step_name
        progress["steps"].append({"name": step_name, **result})
        if is_last:
            progress["running"] = False
            progress["finished_at"] = datetime.now(timezone.utc).isoformat()
        await _set_config_value(db, PROGRESS_KEY, progress)
        await db.commit()

    try:
        # 1. 백업 — production/scripts/backup.sh 또는 직접 pg_dump + tar
        backup_script = install_dir / "production" / "scripts" / "backup.sh"
        if backup_script.exists():
            res = await _run_step(
                "backup", ["bash", str(backup_script), str(backup_dir)],
                cwd=install_dir,
            )
        else:
            # fallback — pg_dump만
            db_url = os.environ.get("DATABASE_URL", "")
            db_name = "general_school"
            if "/" in db_url:
                db_name = db_url.rsplit("/", 1)[-1].split("?")[0]
            res = await _run_step(
                "backup",
                ["bash", "-c",
                 f"pg_dump {db_name} | gzip > {db_backup_path}"],
                cwd=install_dir,
            )
        await _push("backup", res)
        if not res["ok"]:
            raise RuntimeError("backup 실패")

        # 2. 현재 commit 저장
        res = await _run_step(
            "from_commit", ["git", "rev-parse", "HEAD"], cwd=install_dir,
        )
        await _push("from_commit", res)
        if not res["ok"]:
            raise RuntimeError("git rev-parse 실패")
        progress["from_commit"] = res["stdout"].strip()

        if dry_run:
            # dry run — 여기까지만 (백업 + 현재 commit 기록)
            await _push("dry_run_done", {"ok": True, "stdout": "dry-run 완료. 백업까지만 진행."}, is_last=True)
            return {"ok": True, "dry_run": True, **progress}

        # 3. git pull
        res = await _run_step("git_pull", ["git", "pull", "origin", "main"], cwd=install_dir)
        await _push("git_pull", res)
        if not res["ok"]:
            raise RuntimeError("git pull 실패")

        # to_commit 기록
        res2 = await _run_step("to_commit", ["git", "rev-parse", "HEAD"], cwd=install_dir)
        progress["to_commit"] = res2["stdout"].strip()

        # 4. pip install
        venv_pip = install_dir / "backend" / "venv" / "bin" / "pip"
        res = await _run_step(
            "pip_install",
            [str(venv_pip), "install", "-q", "-r", "requirements.txt"],
            cwd=install_dir / "backend",
        )
        await _push("pip_install", res)
        if not res["ok"]:
            raise RuntimeError("pip install 실패")

        # 5. alembic upgrade head
        venv_alembic = install_dir / "backend" / "venv" / "bin" / "alembic"
        res = await _run_step(
            "alembic", [str(venv_alembic), "upgrade", "head"],
            cwd=install_dir / "backend",
        )
        await _push("alembic", res)
        if not res["ok"]:
            raise RuntimeError("alembic upgrade 실패")

        # 6. frontend npm ci + build
        res = await _run_step(
            "npm_install",
            ["npm", "ci", "--legacy-peer-deps", "--silent"],
            cwd=install_dir / "frontend",
        )
        await _push("npm_install", res)
        if not res["ok"]:
            raise RuntimeError("npm ci 실패")

        res = await _run_step(
            "npm_build", ["npm", "run", "build"],
            cwd=install_dir / "frontend",
        )
        await _push("npm_build", res)
        if not res["ok"]:
            raise RuntimeError("npm run build 실패")

        # standalone static 복사
        next_static = install_dir / "frontend" / ".next" / "static"
        standalone_next = install_dir / "frontend" / ".next" / "standalone" / ".next"
        if next_static.exists() and standalone_next.exists():
            try:
                tgt = standalone_next / "static"
                if tgt.exists():
                    shutil.rmtree(tgt)
                shutil.copytree(next_static, tgt)
            except Exception as exc:
                log.warning("standalone static copy fail: %s", exc)

        # 7. hocuspocus (있으면)
        hocus_dir = install_dir / "backend-hocuspocus"
        if hocus_dir.is_dir():
            res = await _run_step(
                "hocuspocus",
                ["bash", "-c", "npm ci --silent && npm run build"],
                cwd=hocus_dir,
            )
            await _push("hocuspocus", res)
            if not res["ok"]:
                raise RuntimeError("hocuspocus build 실패")

        # 8. systemctl restart
        res = await _run_step(
            "restart",
            ["sudo", "-n", "systemctl", "restart",
             "gs-backend", "gs-frontend", "gs-hocuspocus"],
            cwd=install_dir,
        )
        await _push("restart", res)
        if not res["ok"]:
            raise RuntimeError("systemctl restart 실패")

        # 9. health check (잠시 대기 후)
        await asyncio.sleep(3)
        healthy = await _health_check()
        await _push(
            "health",
            {"ok": healthy,
             "stdout": "OK" if healthy else "health check timeout"},
            is_last=True,
        )
        if not healthy:
            raise RuntimeError("health check 실패")

        # 최종 결과 보존
        result = {
            "ok": True,
            "from_commit": progress["from_commit"],
            "to_commit": progress["to_commit"],
            "started_at": started_at,
            "finished_at": progress.get("finished_at"),
            "steps_count": len(progress["steps"]),
        }
        await _set_config_value(db, LAST_RESULT_KEY, result)
        await db.commit()
        return result

    except Exception as exc:
        # rollback
        log.error("update failed at %s: %s", progress.get("current_step"), exc)
        rollback_result = await _rollback(
            install_dir,
            from_commit=progress.get("from_commit"),
            db_backup_path=db_backup_path,
            push_progress=_push,
        )
        final = {
            "ok": False,
            "error": str(exc),
            "failed_step": progress.get("current_step"),
            "rollback": rollback_result,
            "from_commit": progress.get("from_commit"),
        }
        await _set_config_value(db, LAST_RESULT_KEY, final)
        await db.commit()
        return final

    finally:
        _release_lock()


async def _rollback(
    install_dir: Path,
    *,
    from_commit: str | None,
    db_backup_path: Path,
    push_progress,
) -> dict:
    """실패 시 자동 복원: git reset + DB 복원 + 재시작."""
    result: dict[str, Any] = {"ok": True, "steps": []}

    # 1. git reset
    if from_commit:
        res = await _run_step(
            "rollback_git", ["git", "reset", "--hard", from_commit],
            cwd=install_dir,
        )
        await push_progress("rollback_git", res)
        result["steps"].append({"name": "git_reset", **res})
        if not res["ok"]:
            result["ok"] = False

    # 2. DB 복원 (있으면)
    if db_backup_path.exists():
        db_url = os.environ.get("DATABASE_URL", "")
        db_name = "general_school"
        if "/" in db_url:
            db_name = db_url.rsplit("/", 1)[-1].split("?")[0]
        res = await _run_step(
            "rollback_db",
            ["bash", "-c",
             f"gunzip -c {db_backup_path} | psql {db_name}"],
            cwd=install_dir,
        )
        await push_progress("rollback_db", res)
        result["steps"].append({"name": "db_restore", **res})
        if not res["ok"]:
            result["ok"] = False

    # 3. restart
    res = await _run_step(
        "rollback_restart",
        ["sudo", "-n", "systemctl", "restart",
         "gs-backend", "gs-frontend", "gs-hocuspocus"],
        cwd=install_dir,
    )
    await push_progress("rollback_restart", res, is_last=True)
    result["steps"].append({"name": "restart", **res})
    if not res["ok"]:
        result["ok"] = False

    return result
