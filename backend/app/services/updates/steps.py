"""9단계 실행 함수 + 최적화 (skip 로직).

각 단계는 (db, install_dir, ctx) → dict 반환.
ctx는 단계간 공유 데이터 (from_commit, backup_path 등).

skip 로직 (commit `20a9493` 이후):
  - alembic: current == heads면 skip
  - pip install: requirements.txt diff 없으면 skip
  - npm ci: package-lock.json 변경 없으면 skip
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.services.updates.shell import health_check, run

log = logging.getLogger(__name__)


# ── 1. backup ──

async def backup(install_dir: Path, ctx: dict) -> dict:
    """pg_dump + storage tar.gz. 백업 경로 + DB 백업 경로를 ctx에 저장."""
    backup_dir = Path(os.environ.get("BACKUP_DEST", "/tmp/gs-update-backups"))
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    db_backup_path = backup_dir / f"gs-pre-update-{ts}.sql.gz"
    full_backup_path = backup_dir / f"gs-pre-update-{ts}.tar.gz"
    ctx["backup_path"] = str(full_backup_path)
    ctx["db_backup_path"] = str(db_backup_path)

    backup_script = install_dir / "production" / "scripts" / "backup.sh"
    if backup_script.exists():
        return await run(
            "backup", ["bash", str(backup_script), str(backup_dir)],
            cwd=install_dir,
        )

    # fallback — pg_dump만
    db_url = os.environ.get("DATABASE_URL", "")
    db_name = "general_school"
    if "/" in db_url:
        db_name = db_url.rsplit("/", 1)[-1].split("?")[0]
    return await run(
        "backup",
        ["bash", "-c", f"pg_dump {db_name} | gzip > {db_backup_path}"],
        cwd=install_dir,
    )


# ── 2. from_commit ──

async def from_commit(install_dir: Path, ctx: dict) -> dict:
    """현재 git HEAD 저장 (rollback용)."""
    res = await run("from_commit", ["git", "rev-parse", "HEAD"], cwd=install_dir)
    if res["ok"]:
        ctx["from_commit"] = res["stdout"].strip()
    return res


# ── 3. git_pull ──

async def git_pull(install_dir: Path, ctx: dict) -> dict:
    res = await run("git_pull", ["git", "pull", "origin", "main"], cwd=install_dir)
    if res["ok"]:
        head = await run("to_commit", ["git", "rev-parse", "HEAD"], cwd=install_dir)
        if head["ok"]:
            ctx["to_commit"] = head["stdout"].strip()
    return res


# ── 4. pip install (최적화: requirements.txt diff 없으면 skip) ──

async def pip_install(install_dir: Path, ctx: dict) -> dict:
    """requirements.txt가 from_commit과 to_commit 사이에 변경 없으면 skip."""
    if ctx.get("from_commit") and ctx.get("to_commit"):
        diff = await run(
            "pip_diff_check",
            ["git", "diff", "--quiet",
             f"{ctx['from_commit']}..{ctx['to_commit']}",
             "--", "backend/requirements.txt"],
            cwd=install_dir,
        )
        # git diff --quiet: 0 = 변경 없음, 1 = 변경 있음
        if diff["returncode"] == 0:
            return {"ok": True, "stdout": "skipped (requirements.txt unchanged)",
                    "stderr": "", "returncode": 0, "took_sec": diff["took_sec"]}

    venv_pip = install_dir / "backend" / "venv" / "bin" / "pip"
    return await run(
        "pip_install",
        [str(venv_pip), "install", "-q", "-r", "requirements.txt"],
        cwd=install_dir / "backend",
    )


# ── 5. alembic (최적화: current == heads면 skip) ──

async def alembic(install_dir: Path, ctx: dict) -> dict:
    """현재 revision == heads면 마이그레이션 skip."""
    venv_alembic = install_dir / "backend" / "venv" / "bin" / "alembic"

    cur = await run(
        "alembic_current", [str(venv_alembic), "current"],
        cwd=install_dir / "backend", timeout=30,
    )
    heads = await run(
        "alembic_heads", [str(venv_alembic), "heads"],
        cwd=install_dir / "backend", timeout=30,
    )
    if cur["ok"] and heads["ok"]:
        # current는 'rev (head)' 또는 'rev', heads는 'rev (head)'
        # 첫 단어 (rev id)만 비교
        cur_rev = cur["stdout"].strip().split(" ")[0] if cur["stdout"].strip() else ""
        head_rev = heads["stdout"].strip().split(" ")[0] if heads["stdout"].strip() else ""
        if cur_rev and head_rev and cur_rev == head_rev:
            return {"ok": True, "stdout": f"skipped (already at {head_rev[:8]})",
                    "stderr": "", "returncode": 0,
                    "took_sec": cur["took_sec"] + heads["took_sec"]}

    return await run(
        "alembic", [str(venv_alembic), "upgrade", "head"],
        cwd=install_dir / "backend",
    )


# ── 6. npm install + build (최적화: lock 변경 없으면 ci skip) ──

async def npm_install(install_dir: Path, ctx: dict) -> dict:
    """package-lock.json 변경 없으면 npm ci skip."""
    if ctx.get("from_commit") and ctx.get("to_commit"):
        diff = await run(
            "npm_diff_check",
            ["git", "diff", "--quiet",
             f"{ctx['from_commit']}..{ctx['to_commit']}",
             "--", "frontend/package-lock.json", "frontend/package.json"],
            cwd=install_dir,
        )
        if diff["returncode"] == 0 and (install_dir / "frontend" / "node_modules").exists():
            return {"ok": True, "stdout": "skipped (package-lock unchanged)",
                    "stderr": "", "returncode": 0, "took_sec": diff["took_sec"]}

    return await run(
        "npm_install", ["npm", "ci", "--legacy-peer-deps", "--silent"],
        cwd=install_dir / "frontend",
    )


async def npm_build(install_dir: Path, ctx: dict) -> dict:
    """next build + standalone static 복사."""
    res = await run("npm_build", ["npm", "run", "build"], cwd=install_dir / "frontend")
    if not res["ok"]:
        return res

    # standalone static 복사 (next standalone 모드 필수)
    next_static = install_dir / "frontend" / ".next" / "static"
    standalone_next = install_dir / "frontend" / ".next" / "standalone" / ".next"
    if next_static.exists() and standalone_next.exists():
        try:
            tgt = standalone_next / "static"
            if tgt.exists():
                shutil.rmtree(tgt)
            shutil.copytree(next_static, tgt)
            res["stdout"] += "\n[static copied to standalone]"
        except Exception as exc:
            log.warning("standalone static copy fail: %s", exc)
    return res


# ── 7. hocuspocus (있으면) ──

async def hocuspocus(install_dir: Path, ctx: dict) -> dict | None:
    """backend-hocuspocus 디렉터리 없으면 None."""
    hocus_dir = install_dir / "backend-hocuspocus"
    if not hocus_dir.is_dir():
        return None
    # lock 변경 없으면 npm ci skip
    skip_install = ""
    if ctx.get("from_commit") and ctx.get("to_commit"):
        diff = await run(
            "hocus_diff_check",
            ["git", "diff", "--quiet",
             f"{ctx['from_commit']}..{ctx['to_commit']}",
             "--", "backend-hocuspocus/package-lock.json"],
            cwd=install_dir,
        )
        if diff["returncode"] == 0 and (hocus_dir / "node_modules").exists():
            skip_install = " (skip npm ci)"

    cmd = "npm run build" if skip_install else "npm ci --silent && npm run build"
    return await run("hocuspocus", ["bash", "-c", cmd], cwd=hocus_dir)


# ── 8. systemctl restart ──

async def restart_services(install_dir: Path, ctx: dict) -> dict:
    return await run(
        "restart",
        ["sudo", "-n", "systemctl", "restart",
         "gs-backend", "gs-frontend", "gs-hocuspocus"],
        cwd=install_dir,
    )


# ── 9. health check ──

async def health(install_dir: Path, ctx: dict) -> dict:
    """잠시 대기 후 /api/health polling."""
    import asyncio
    await asyncio.sleep(3)
    healthy = await health_check()
    return {
        "ok": healthy,
        "stdout": "OK" if healthy else "health check timeout",
        "stderr": "" if healthy else "/api/health did not return 200 within 60s",
        "returncode": 0 if healthy else -1,
        "took_sec": None,
    }
