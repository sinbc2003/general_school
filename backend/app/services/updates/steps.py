"""실행 단계 함수 + 최적화 (skip 로직) + 충돌 검출 (preflight).

각 단계는 (install_dir, ctx) → dict 반환.
ctx는 단계간 공유 데이터 (from_commit, backup_path 등).

skip 로직:
  - alembic: current == heads면 skip
  - pip install: requirements.txt diff 없으면 skip
  - npm ci: package-lock.json 변경 없으면 skip

충돌 검출 (preflight, 단계 0):
  - git status로 학교 로컬 변경 검출
  - 변경 있으면 force=False 시 차단 (사용자 결정 요구)
  - force=True면 git stash → pull → stash pop 시도

위험 변경 검출 (preflight, 단계 0):
  - git pull 받을 commit들에 drop_column / drop_table / DELETE 포함 여부 검사
  - 위험 변경 있으면 결과에 표시 (사용자가 dry-run 권장)
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.services.updates.shell import health_check, run

log = logging.getLogger(__name__)


# ── 0. preflight (학교 로컬 변경 + 위험 변경 검출) ──

async def preflight(install_dir: Path, ctx: dict) -> dict:
    """학교 로컬 변경 + GitHub 위험 마이그레이션 검출.

    ctx['force_local_override'] = True면 로컬 변경 무시하고 강행 (stash 후 pull).
    ctx['allow_data_destructive'] = True면 위험 변경 허용.
    """
    force = ctx.get("force_local_override", False)
    allow_destructive = ctx.get("allow_data_destructive", False)

    # 1. 학교 로컬 변경 검출 (git status)
    status = await run(
        "git_status", ["git", "status", "--porcelain"],
        cwd=install_dir, timeout=15,
    )
    local_dirty = bool(status["ok"] and status["stdout"].strip())

    # 2. 학교 로컬 commit 검출 (origin/main과 차이)
    local_commits_res = await run(
        "local_commits",
        ["git", "log", "--oneline", "@{u}..HEAD"],
        cwd=install_dir, timeout=15,
    )
    local_commits = (local_commits_res["stdout"].strip().split("\n")
                     if local_commits_res["ok"] and local_commits_res["stdout"].strip() else [])
    local_commits = [c for c in local_commits if c]

    ctx["local_dirty"] = local_dirty
    ctx["local_commits"] = local_commits

    # 3. GitHub 위험 변경 검출 (pull 받을 commit들의 마이그레이션 + drop)
    risky = []
    await run("fetch", ["git", "fetch", "origin", "main"], cwd=install_dir, timeout=30)
    diff_files = await run(
        "diff_names",
        ["git", "diff", "--name-only", "HEAD..origin/main"],
        cwd=install_dir, timeout=15,
    )
    if diff_files["ok"]:
        for f in (diff_files["stdout"] or "").splitlines():
            f = f.strip()
            if not f:
                continue
            if "alembic/versions/" in f:
                # 그 파일 내용 미리보기
                preview = await run(
                    "diff_show", ["git", "show", f"origin/main:{f}"],
                    cwd=install_dir, timeout=15,
                )
                body = preview["stdout"] if preview["ok"] else ""
                if "op.drop_column" in body:
                    risky.append({"file": f, "kind": "drop_column"})
                if "op.drop_table" in body:
                    risky.append({"file": f, "kind": "drop_table"})
                if "op.execute" in body and any(
                    kw in body.upper() for kw in ("DELETE ", "UPDATE ", "TRUNCATE ")
                ):
                    risky.append({"file": f, "kind": "execute_dml"})
    ctx["risky_changes"] = risky

    # 차단 결정
    blocked_reasons = []
    if local_dirty and not force:
        blocked_reasons.append(
            f"학교 로컬 변경 미커밋 ({len(status['stdout'].splitlines())}개 파일). "
            "force_local_override=True로 시작하면 git stash 후 진행."
        )
    if local_commits and not force:
        blocked_reasons.append(
            f"학교 로컬 commit {len(local_commits)}개 (GitHub에 없음). "
            "그대로 진행하면 git pull로 rebase/merge 필요. "
            "force_local_override=True로 시작하면 강행 — 충돌 시 자동 rollback."
        )
    if risky and not allow_destructive:
        kinds = ", ".join(sorted({r["kind"] for r in risky}))
        blocked_reasons.append(
            f"새 commit에 위험 마이그레이션 ({kinds}). "
            "백업 권장. allow_data_destructive=True로 시작하면 진행."
        )

    if blocked_reasons:
        return {
            "ok": False,
            "stdout": "BLOCKED:\n- " + "\n- ".join(blocked_reasons),
            "stderr": "",
            "returncode": -10,
            "took_sec": 0.5,
            "blocked": True,
            "reasons": blocked_reasons,
            "local_dirty": local_dirty,
            "local_commits": local_commits,
            "risky_changes": risky,
        }

    # 통과 — 로컬 변경 있으면 stash
    stash_msg = ""
    if local_dirty:
        st = await run(
            "stash", ["git", "stash", "push", "-m",
                      "pre-update-stash (school local changes)"],
            cwd=install_dir, timeout=30,
        )
        if st["ok"]:
            ctx["stashed"] = True
            stash_msg = " (학교 변경 stash됨 — pull 후 pop 시도)"
        else:
            return {
                "ok": False,
                "stdout": "stash 실패 — 학교 변경을 수동 commit 또는 폐기 필요",
                "stderr": st.get("stderr", ""),
                "returncode": -11, "took_sec": 0.5,
            }

    return {
        "ok": True,
        "stdout": (
            f"preflight OK — local_dirty={local_dirty}, "
            f"local_commits={len(local_commits)}, risky={len(risky)}{stash_msg}"
        ),
        "stderr": "", "returncode": 0, "took_sec": 0.5,
        "local_dirty": local_dirty,
        "local_commits": local_commits,
        "risky_changes": risky,
    }


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
    """git pull + stash pop (preflight에서 stash됐다면)."""
    res = await run("git_pull", ["git", "pull", "origin", "main"], cwd=install_dir)
    if not res["ok"]:
        return res

    # stash 있었으면 pop 시도
    if ctx.get("stashed"):
        pop = await run(
            "stash_pop", ["git", "stash", "pop"],
            cwd=install_dir, timeout=15,
        )
        if not pop["ok"]:
            # conflict 발생 — pull은 성공했지만 학교 변경 적용 실패
            res["stdout"] += (
                "\n[WARN] git stash pop 실패 (학교 변경과 pull한 변경 충돌). "
                "학교 변경은 git stash list에서 확인 가능. 자동 rollback 진행."
            )
            res["ok"] = False
            res["stderr"] += "\n[stash pop]: " + pop["stderr"]
            return res
        res["stdout"] += "\n[stash pop OK — 학교 변경 다시 적용됨]"

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
    """frontend·hocuspocus 재시작.

    ⚠️ gs-backend는 여기서 재시작하지 않는다. updater가 gs-backend 프로세스
    안에서 돌기 때문에 여기서 gs-backend를 재시작하면 자기 자신이 죽어
    success/health 기록을 못 남긴다(progress·last_result null 증상). gs-backend는
    성공 결과를 DB에 commit한 뒤 executor가 restart_backend_detached로 분리 재시작.
    """
    return await run(
        "restart",
        ["sudo", "-n", "systemctl", "restart", "gs-frontend", "gs-hocuspocus"],
        cwd=install_dir,
    )


async def restart_backend_detached(install_dir: Path) -> dict:
    """gs-backend 재시작 — systemd-run으로 PID1 소유 transient unit에서 실행.

    updater 프로세스(=gs-backend)가 곧 죽어도 systemd가 재시작을 끝까지 수행.
    반드시 성공 결과를 DB에 기록·commit한 뒤 호출할 것.

    systemd-run이 없거나 sudo가 거부하면(설치마다 sudoers 범위가 다를 수 있음)
    일반 `systemctl restart`로 폴백 — 이때도 결과는 이미 commit돼 있어 안전.
    """
    res = await run(
        "restart_backend",
        ["sudo", "-n", "systemd-run", "--collect", "--quiet",
         "systemctl", "restart", "gs-backend"],
        cwd=install_dir, timeout=20,
    )
    if res.get("ok"):
        return res
    log.warning("systemd-run restart failed (rc=%s) — falling back to systemctl: %s",
                res.get("returncode"), res.get("stderr", "")[:200])
    return await run(
        "restart_backend_fallback",
        ["sudo", "-n", "systemctl", "restart", "gs-backend"],
        cwd=install_dir, timeout=20,
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
