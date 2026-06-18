"""메인 업데이트 흐름 — apply_update().

9단계 + 실패 시 자동 rollback. 진행 상황은 SchoolConfig에 polling용으로 갱신.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.updates import lock, progress, rollback, steps
from app.services.updates.shell import detect_install_dir, run

log = logging.getLogger(__name__)


# 10단계 정의 — (step_name, function, is_optional)
STEPS = [
    ("preflight", steps.preflight, False),  # 학교 로컬 변경 + 위험 변경 검출
    ("backup", steps.backup, False),
    ("from_commit", steps.from_commit, False),
    ("git_pull", steps.git_pull, False),
    ("pip_install", steps.pip_install, False),
    ("alembic", steps.alembic, False),
    ("npm_install", steps.npm_install, False),
    ("npm_build", steps.npm_build, False),
    ("hocuspocus", steps.hocuspocus, True),
    ("restart", steps.restart_services, False),
    ("health", steps.health, False),
]


async def apply_update(
    db: AsyncSession,
    *,
    user_id: int,
    dry_run: bool = False,
    force_local_override: bool = False,
    allow_data_destructive: bool = False,
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
    ctx: dict[str, Any] = {
        "force_local_override": force_local_override,
        "allow_data_destructive": allow_data_destructive,
    }

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
            # dry_run이면 preflight + backup + from_commit 까지만
            if dry_run and step_name not in ("preflight", "backup", "from_commit"):
                await push_step(
                    "dry_run_done",
                    {"ok": True,
                     "stdout": "dry-run 완료. preflight + 백업까지만 진행. 실제 변경은 안 함."},
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

        # 빌드·마이그레이션까지 성공. gs-backend(=현재 프로세스)는 아직 옛 코드라
        # "새 코드가 실제 부팅되는지"는 재시작 후에야 안다. 그래서:
        #   - verified=False로 기록 (UI는 "재시작/확정 대기"로 표시)
        #   - pending_verify 마커 남김 → 다음 부팅 시 리컨실러가 HEAD==to_commit이면
        #     verified=True로 확정 (=새 backend 정상 부팅 증거)
        # 새 backend가 부팅 실패 시: 자동 rollback은 못 하지만(프로세스 사망) 시작 전
        # 백업이 있어 수동 복원 가능. UI도 verified=False로 남아 오인하지 않는다.
        final = {
            "ok": True,
            "verified": False,
            "from_commit": ctx.get("from_commit"),
            "to_commit": ctx.get("to_commit"),
            "started_at": started_at,
            "finished_at": progress_state.get("finished_at"),
            "steps_count": len(progress_state["steps"]),
            "backend_restart": "pending",
            "backup_path": ctx.get("backup_path"),
        }
        await progress.set_last_result(db, final)
        await progress.set_pending_verify(db, {
            "to_commit": ctx.get("to_commit"),
            "from_commit": ctx.get("from_commit"),
            "started_at": started_at,
        })
        await db.commit()

        # 결과를 commit한 뒤 gs-backend를 분리 재시작. lock을 먼저 풀어야
        # 재시작 중 프로세스가 죽어도 stale lock이 안 남는다.
        lock.release()
        try:
            r = await steps.restart_backend_detached(install_dir)
            final["backend_restart"] = "issued" if r.get("ok") else "issue_failed"
        except Exception as exc:  # 재시작 명령 실패해도 코드는 이미 적용됨
            log.warning("detached backend restart failed: %s", exc)
            final["backend_restart"] = "error"
        return final

    except Exception as exc:
        log.error("update failed at %s: %s", progress_state.get("current_step"), exc)
        # rollback은 gs-backend를 재시작하지 않는다(steps.rollback). 현재 gs-backend는
        # 아직 옛 코드라 git reset(옛 코드) + pg_restore(옛 DB)와 일관 → 그대로 둠.
        # 따라서 이 except 블록이 끝까지 실행되어 실패 결과가 확실히 기록된다.
        rb = await rollback.perform(
            install_dir,
            from_commit=ctx.get("from_commit"),
            db_backup_path=ctx.get("db_backup_path"),
            stashed=ctx.get("stashed", False),
            push_step=push_step,
        )
        final = {
            "ok": False,
            "verified": False,
            "error": str(exc),
            "failed_step": progress_state.get("current_step"),
            "rollback": rb,
            "from_commit": ctx.get("from_commit"),
            "started_at": started_at,
            "finished_at": progress_state.get("finished_at"),
        }
        await progress.set_last_result(db, final)
        await progress.clear_pending_verify(db)  # 실패 — 확정 대기 없음
        await db.commit()
        return final

    finally:
        lock.release()


async def reconcile_pending_update(db: AsyncSession) -> None:
    """부팅 시(lifespan) 1회 호출 — 직전 업데이트의 pending_verify를 확정/정리.

    이 코드가 실행된다는 것 자체가 backend가 정상 부팅됐다는 증거. HEAD가 직전
    업데이트의 to_commit과 같으면 last_result.verified=True로 확정한다. 마커는 항상
    제거(부팅 실패 시엔 애초에 이 코드가 안 돌아 마커가 남고, 다음 정상 부팅에서 정리).
    절대 부팅을 막지 않도록 호출부에서 try/except로 감쌀 것.
    """
    pending = await progress.get_pending_verify(db)
    if not pending:
        return
    install_dir = detect_install_dir()
    res = await run("verify_head", ["git", "rev-parse", "HEAD"], cwd=install_dir, timeout=15)
    head = res["stdout"].strip() if res.get("ok") else ""
    to_commit = str(pending.get("to_commit") or "").strip()
    last = await progress.get_last_result(db) or {}
    if to_commit and head == to_commit:
        last["verified"] = True
        last["backend_restart"] = "ok"
        log.info("update reconcile: confirmed new backend booted at %s", head[:8])
    else:
        last["verified"] = False
        last["backend_restart"] = "unconfirmed"
        log.warning("update reconcile: HEAD %s != to_commit %s", head[:8], to_commit[:8])
    await progress.set_last_result(db, last)
    await progress.clear_pending_verify(db)
