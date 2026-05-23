"""GitHub 자동 업데이트 알림 — public repo polling.

학교 자체 서버는 자동 git pull 안 함 (alembic migration·테스트 미검증 코드 자동
적용은 사고 위험). 대신 새 commit이 있으면 super_admin에게 in-app 알림 + 가이드
페이지 노출 → 사용자가 수동으로 `git pull && systemctl restart gs-backend` 실행.

설계:
  - 1시간(scheduler tick) 안에서 self-rate-limited (24h 1회)
  - subprocess `git rev-parse HEAD`로 학교 서버 현재 commit
  - httpx로 https://api.github.com/repos/{owner}/{repo}/commits/{branch}
  - 다르면 SchoolConfig에 last_notified_remote_sha 저장 → 같은 remote sha 재알림 X
  - public repo 무인증 (시간당 60회 한도 충분). private이면 GITHUB_TOKEN env 사용

환경변수 (.env 또는 systemd EnvironmentFile):
  GITHUB_UPDATE_REPO=sinbc2003/general_school   # owner/repo
  GITHUB_UPDATE_BRANCH=main                       # default main
  GITHUB_UPDATE_TOKEN=                            # optional (private repo)

GITHUB_UPDATE_REPO가 비면 아예 polling 자체 skip → 로컬 dev 등 비-운영 환경 안전.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SchoolConfig

log = logging.getLogger(__name__)


GITHUB_API_BASE = "https://api.github.com"
HTTP_TIMEOUT = 10.0  # GitHub API call 한도 (학교 LAN slow OK)
CONFIG_KEY_LAST_NOTIFIED = "github_update.last_notified_remote_sha"


def _env_repo() -> tuple[str | None, str, str | None]:
    """(repo, branch, token). repo 비면 polling off."""
    repo = (os.environ.get("GITHUB_UPDATE_REPO") or "").strip() or None
    branch = (os.environ.get("GITHUB_UPDATE_BRANCH") or "main").strip() or "main"
    token = (os.environ.get("GITHUB_UPDATE_TOKEN") or "").strip() or None
    return repo, branch, token


def is_polling_enabled() -> bool:
    repo, _, _ = _env_repo()
    return repo is not None


async def get_local_commit() -> dict | None:
    """학교 서버의 현재 git HEAD. 비-git 환경 / 명령 실패 시 None.

    동기 subprocess이지만 짧음 (수 ms). asyncio.to_thread로 비차단.
    """
    def _run() -> dict | None:
        try:
            # backend/ 또는 repo root에서 호출 — repo root 추정
            cwd = Path(__file__).resolve().parents[3]  # backend/app/services → repo root
            full = subprocess.run(
                ["git", "log", "-1", "--format=%H%n%s%n%ci"],
                cwd=cwd, capture_output=True, text=True, timeout=5, check=False,
            )
            if full.returncode != 0:
                return None
            parts = (full.stdout or "").split("\n", 2)
            if not parts or not parts[0].strip():
                return None
            return {
                "sha": parts[0].strip(),
                "message": parts[1].strip() if len(parts) > 1 else "",
                "committed_at": parts[2].strip() if len(parts) > 2 else "",
            }
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            log.warning("get_local_commit failed: %s", e)
            return None

    return await asyncio.to_thread(_run)


async def get_remote_commit() -> dict | None:
    """GitHub HEAD commit. 환경변수 미설정·네트워크·404 시 None."""
    repo, branch, token = _env_repo()
    if not repo:
        return None
    url = f"{GITHUB_API_BASE}/repos/{repo}/commits/{branch}"
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                log.warning("github commits API status=%d url=%s", r.status_code, url)
                return None
            data = r.json()
            return {
                "sha": data.get("sha"),
                "message": (data.get("commit", {}).get("message") or "").split("\n", 1)[0],
                "committed_at": data.get("commit", {}).get("committer", {}).get("date") or "",
                "html_url": data.get("html_url") or "",
                "author": data.get("commit", {}).get("author", {}).get("name") or "",
            }
    except (httpx.RequestError, httpx.HTTPError, ValueError) as e:
        log.warning("get_remote_commit network error: %s", e)
        return None


async def get_commits_between(local_sha: str, remote_sha: str, limit: int = 20) -> list[dict]:
    """local→remote 사이 commit list. GitHub /compare API.

    limit는 응답 commit 수 cap. 너무 많이 밀려 있어도 UI 부담 차단.
    """
    repo, _, token = _env_repo()
    if not repo or not local_sha or not remote_sha or local_sha == remote_sha:
        return []
    url = f"{GITHUB_API_BASE}/repos/{repo}/compare/{local_sha}...{remote_sha}"
    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return []
            data = r.json()
            commits = data.get("commits") or []
            out: list[dict] = []
            for c in commits[-limit:]:  # 최근 limit개 (원격이 더 신선)
                out.append({
                    "sha": c.get("sha"),
                    "message": (c.get("commit", {}).get("message") or "").split("\n", 1)[0],
                    "author": c.get("commit", {}).get("author", {}).get("name") or "",
                    "committed_at": c.get("commit", {}).get("committer", {}).get("date") or "",
                    "html_url": c.get("html_url") or "",
                })
            return out
    except (httpx.RequestError, httpx.HTTPError, ValueError) as e:
        log.warning("get_commits_between network error: %s", e)
        return []


async def _get_last_notified_sha(db: AsyncSession) -> str | None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == CONFIG_KEY_LAST_NOTIFIED)
    )).scalar_one_or_none()
    return (row.value or None) if row else None


async def _set_last_notified_sha(db: AsyncSession, sha: str) -> None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == CONFIG_KEY_LAST_NOTIFIED)
    )).scalar_one_or_none()
    if row:
        row.value = sha
        row.updated_at = datetime.now(timezone.utc)
    else:
        db.add(SchoolConfig(key=CONFIG_KEY_LAST_NOTIFIED, value=sha, encrypted=False))


async def check_and_notify(db: AsyncSession) -> dict:
    """cron 또는 admin 강제호출. 새 commit이 있고 미알림이면 super_admin 통지.

    returns: {
      enabled: bool,                       # GITHUB_UPDATE_REPO env 설정 여부
      local: {sha, message, committed_at} | None,
      remote: {sha, message, committed_at, author, html_url} | None,
      behind_count: int,                   # local→remote 사이 commit 수
      notified: bool,                      # 이번 호출에서 알림 발송했는지
    }
    """
    if not is_polling_enabled():
        return {"enabled": False, "local": None, "remote": None, "behind_count": 0, "notified": False}

    local = await get_local_commit()
    remote = await get_remote_commit()
    if not local or not remote or not remote.get("sha"):
        return {
            "enabled": True, "local": local, "remote": remote,
            "behind_count": 0, "notified": False,
        }

    remote_sha = remote["sha"]
    local_sha = local["sha"]
    if local_sha == remote_sha:
        return {
            "enabled": True, "local": local, "remote": remote,
            "behind_count": 0, "notified": False,
        }

    commits = await get_commits_between(local_sha, remote_sha, limit=20)
    behind = len(commits) if commits else 1  # compare API 실패해도 최소 1

    # 이전에 같은 remote_sha 알림 보냈으면 skip (중복 차단)
    last_notified = await _get_last_notified_sha(db)
    if last_notified == remote_sha:
        return {
            "enabled": True, "local": local, "remote": remote,
            "behind_count": behind, "notified": False,
        }

    # super_admin 통지
    from app.models.user import User
    from app.services.notification import notify_users

    admin_ids = (await db.execute(
        select(User.id).where(User.role == "super_admin", User.status != "disabled")
    )).scalars().all()
    if admin_ids:
        first_msg = (commits[0]["message"] if commits else remote["message"]) or ""
        body = (
            f"새 commit {behind}개 — '{first_msg[:80]}'"
            + (" 외" if behind > 1 else "")
            + ". /system/updates 에서 확인 후 git pull + 재시작."
        )
        try:
            await notify_users(
                db, user_ids=list(admin_ids),
                type="system.update_available",
                title=f"🆕 새 업데이트 {behind}개",
                body=body,
                link_url="/system/updates",
                meta={"remote_sha": remote_sha, "behind_count": behind},
            )
        except Exception:
            log.exception("notify_users for github update failed")

    await _set_last_notified_sha(db, remote_sha)

    return {
        "enabled": True, "local": local, "remote": remote,
        "behind_count": behind, "notified": True,
    }
