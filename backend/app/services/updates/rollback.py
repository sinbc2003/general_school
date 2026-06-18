"""실패 시 3단계 자동 복원: git reset + DB 복원 + 재시작."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Callable

from app.services.updates.shell import run

log = logging.getLogger(__name__)


async def perform(
    install_dir: Path,
    *,
    from_commit: str | None,
    db_backup_path: str | None,
    stashed: bool = False,
    push_step: Callable,  # async (step_name, result, is_last=False) → None
) -> dict:
    """실패 시 복원: git reset + DB 복원 + (stash 복원) + 재시작.

    stashed=True면 preflight에서 학교 변경을 stash했음 → git reset 후 pop 시도.
    """
    result: dict[str, Any] = {"ok": True, "steps": []}

    # 1. git reset (from_commit으로 되돌림)
    if from_commit:
        res = await run(
            "rollback_git", ["git", "reset", "--hard", from_commit],
            cwd=install_dir,
        )
        await push_step("rollback_git", res)
        result["steps"].append({"name": "git_reset", **res})
        if not res["ok"]:
            result["ok"] = False

    # 1b. stash pop — 학교 변경 복원
    if stashed:
        pop = await run(
            "rollback_stash_pop", ["git", "stash", "pop"],
            cwd=install_dir, timeout=15,
        )
        await push_step("rollback_stash_pop", pop)
        result["steps"].append({"name": "stash_pop", **pop})
        if not pop["ok"]:
            # stash는 남아있음 (사용자가 git stash list로 확인 가능)
            result["ok"] = False

    # 2. DB 복원
    if db_backup_path and Path(db_backup_path).exists():
        db_url = os.environ.get("DATABASE_URL", "")
        db_name = "general_school"
        if "/" in db_url:
            db_name = db_url.rsplit("/", 1)[-1].split("?")[0]
        res = await run(
            "rollback_db",
            ["bash", "-c", f"gunzip -c {db_backup_path} | psql {db_name}"],
            cwd=install_dir,
        )
        await push_step("rollback_db", res)
        result["steps"].append({"name": "db_restore", **res})
        if not res["ok"]:
            result["ok"] = False

    # 3. restart — gs-backend는 재시작하지 않는다.
    #    현재 gs-backend는 업데이터 자신(옛 코드)이라, git reset(옛 코드)·pg_restore
    #    (옛 DB)와 이미 일관. 여기서 gs-backend를 재시작하면 자기 자신을 죽여
    #    실패 결과(last_result)를 못 남긴다(원래 버그). frontend·hocuspocus만 되돌린다.
    res = await run(
        "rollback_restart",
        ["sudo", "-n", "systemctl", "restart", "gs-frontend", "gs-hocuspocus"],
        cwd=install_dir,
    )
    await push_step("rollback_restart", res, is_last=True)
    result["steps"].append({"name": "restart", **res})
    if not res["ok"]:
        result["ok"] = False

    return result
