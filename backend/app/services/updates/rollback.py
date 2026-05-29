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
    push_step: Callable,  # async (step_name, result, is_last=False) → None
) -> dict:
    """실패 시 복원: git reset + DB 복원 + 재시작.

    push_step은 caller(executor)가 제공 — 진행 상황을 SchoolConfig에 갱신.
    """
    result: dict[str, Any] = {"ok": True, "steps": []}

    # 1. git reset
    if from_commit:
        res = await run(
            "rollback_git", ["git", "reset", "--hard", from_commit],
            cwd=install_dir,
        )
        await push_step("rollback_git", res)
        result["steps"].append({"name": "git_reset", **res})
        if not res["ok"]:
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

    # 3. restart
    res = await run(
        "rollback_restart",
        ["sudo", "-n", "systemctl", "restart",
         "gs-backend", "gs-frontend", "gs-hocuspocus"],
        cwd=install_dir,
    )
    await push_step("rollback_restart", res, is_last=True)
    result["steps"].append({"name": "restart", **res})
    if not res["ok"]:
        result["ok"] = False

    return result
