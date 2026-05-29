"""메인 업데이트 흐름 — apply_update().

9단계 + 실패 시 자동 rollback. 진행 상황은 SchoolConfig에 polling용으로 갱신.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.updates import lock, progress, rollback, steps
from app.services.updates.shell import detect_install_dir

log = logging.getLogger(__name__)


# 9단계 정의 — (step_name, function, is_optional)
STEPS = [
    ("backup", steps.backup, False),
    ("from_commit", steps.from_commit, False),
    ("git_pull", steps.git_pull, False),
    ("pip_install", steps.pip_install, False),
    ("alembic", steps.alembic, False),
    ("npm_install", steps.npm_install, False),
    ("npm_build", steps.npm_build, False),
    ("hocuspocus", steps.hocuspocus, True),  # 옵션 — 디렉터리 없으면 skip
    ("restart", steps.restart_services, False),
    ("health", steps.health, False),
]


async def apply_update(
    db: AsyncSession,
    *,
    user_id: int,
    dry_run: bool = False,
) -> dict:
    """업데이트 실행. 백그라운드 task로 호출.

    Args:
        db: 활성 AsyncSession.
        user_id: audit/로그용.
        dry_run: True면 backup + from_commit까지만 (실제 적용 X).

    Returns:
        결과 dict (ok, error?, failed_step?, rollback?, ...).
    """
    if not lock.acquire():
        return {"ok": False, "error": "이미 진행 중인 업데이트가 있습니다", "phase": "lock"}

    install_dir = detect_install_dir()
    started_at = datetime.now(timezone.utc).isoformat()

    # 단계간 공유 컨텍스트 (steps가 채움)
    ctx: dict[str, Any] = {}

    progress_state: dict[str, Any] = {
        "running": True,
        "started_at": started_at,
        "started_by_user_id": user_id,
        "dry_run": dry_run,
        "from_commit": None,
        "to_commit": None,
        "current_step": "init",
        "steps": [],
    }

    async def push_step(name: str, result: dict, *, is_last: bool = False) -> None:
        progress_state["current_step"] = name
        progress_state["steps"].append({"name": name, **result})
        if is_last:
            progress_state["running"] = False
            progress_state["finished_at"] = datetime.now(timezone.utc).isoformat()
        # ctx 추적 정보를 progress에도 반영
        for k in ("from_commit", "to_commit", "backup_path", "db_backup_path"):
            if k in ctx:
                progress_state[k] = ctx[k]
        await progress.set_progress(db, progress_state)
        await db.commit()

    try:
        # 단계별 실행
        for step_name, step_func, is_optional in STEPS:
            # dry_run이면 backup + from_commit 까지만
            if dry_run and step_name not in ("backup", "from_commit"):
                await push_step(
                    "dry_run_done",
                    {"ok": True,
                     "stdout": "dry-run 완료. 백업까지만 진행. 실제 변경은 안 함."},
                    is_last=True,
                )
                final = {
                    "ok": True, "dry_run": True,
                    "from_commit": ctx.get("from_commit"),
                    "started_at": started_at,
                    "finished_at": progress_state.get("finished_at"),
                    "backup_path": ctx.get("backup_path"),
                }
                await progress.set_last_result(db, final)
                await db.commit()
                return final

            result = await step_func(install_dir, ctx)
            if result is None:
                # optional step (hocuspocus 없음 등) — skip
                continue
            is_last = (step_name == "health")
            await push_step(step_name, result, is_last=is_last)
            if not result["ok"]:
                raise RuntimeError(f"{step_name} 실패")

        # 성공
        final = {
            "ok": True,
            "from_commit": ctx.get("from_commit"),
            "to_commit": ctx.get("to_commit"),
            "started_at": started_at,
            "finished_at": progress_state.get("finished_at"),
            "steps_count": len(progress_state["steps"]),
        }
        await progress.set_last_result(db, final)
        await db.commit()
        return final

    except Exception as exc:
        log.error("update failed at %s: %s", progress_state.get("current_step"), exc)
        rb = await rollback.perform(
            install_dir,
            from_commit=ctx.get("from_commit"),
            db_backup_path=ctx.get("db_backup_path"),
            push_step=push_step,
        )
        final = {
            "ok": False,
            "error": str(exc),
            "failed_step": progress_state.get("current_step"),
            "rollback": rb,
            "from_commit": ctx.get("from_commit"),
            "started_at": started_at,
            "finished_at": progress_state.get("finished_at"),
        }
        await progress.set_last_result(db, final)
        await db.commit()
        return final

    finally:
        lock.release()
