"""AI 개발자 서비스 — Claude API 연동 및 코드 생성/적용"""

import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[4]

ALLOWED_DIRS = [
    "frontend/src/app/",
    "frontend/src/components/",
    "frontend/src/config/",
    "frontend/src/lib/",
    "backend/app/modules/",
    "backend/app/models/",
]

# 보안 critical 파일 — AI가 절대 수정할 수 없는 파일들.
# 이 목록을 함부로 줄이지 말 것. 권한 우회·인증 우회·데이터 손실 위험.
BLOCKED_FILES = [
    # 인증·보안 핵심
    "backend/app/core/auth.py",
    "backend/app/core/config.py",
    "backend/app/core/database.py",
    "backend/app/core/encryption.py",
    "backend/app/core/permissions.py",         # 권한 시스템 자체
    "backend/app/core/permission_registry.py",
    "backend/app/core/password_policy.py",
    "backend/app/core/email.py",
    "backend/app/core/backup_scheduler.py",
    "backend/app/core/visibility.py",
    "backend/app/core/totp.py",
    "backend/app/core/ratelimit.py",
    # 부팅 시드 / 자동 부여 (권한 우회 차단)
    "backend/app/main.py",
    "backend/scripts/seed.py",
    "backend/scripts/grant_default_roles.py",
    "backend/scripts/seed_positions.py",
    "backend/scripts/cleanup_stale_permissions.py",
    # 인증·세션·권한 모델 (스키마 변경은 마이그레이션이 별도 필요)
    "backend/app/models/__init__.py",
    "backend/app/models/user.py",
    "backend/app/models/permission.py",
    "backend/app/models/device.py",
    "backend/app/models/setting.py",
    "backend/app/models/audit.py",
    "backend/app/models/position.py",
    # 백업·데이터 복원
    "backend/app/services/backup.py",
    # auth · permissions 라우터 (인증/권한 흐름)
    "backend/app/modules/auth/router.py",
    "backend/app/modules/auth/schemas.py",
    "backend/app/modules/permissions/router.py",
    "backend/app/modules/permissions/permissions.py",
    # AI 개발자 자기 자신 (재귀 권한 상승 차단)
    "backend/app/modules/ai_developer/router.py",
    "backend/app/modules/ai_developer/service.py",
    "backend/app/modules/ai_developer/schemas.py",
    # env / secrets
    ".env",
    ".env.example",
    ".env.production",
]

# 보안 디렉터리 prefix — 이 prefix 시작하면 차단 (해당 디렉터리 통째 보호)
BLOCKED_PREFIXES = [
    "backend/alembic/",     # 마이그레이션 — 함부로 손대면 schema 망가짐
    ".github/",             # CI/CD secrets
    ".claude/",             # Claude Code 설정
    "node_modules/",
    ".next/",
    "venv/",
    "__pycache__/",
]


def read_file_safe(relative_path: str) -> str | None:
    """안전한 파일 읽기 — 경로 traversal + 차단 목록 + 크기 제한."""
    full_path = PROJECT_ROOT / relative_path
    try:
        full_path.resolve().relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return None
    if not is_path_allowed(relative_path):
        return None
    if not full_path.exists() or full_path.stat().st_size > 100_000:
        return None
    return full_path.read_text(encoding="utf-8", errors="replace")


def is_path_allowed(relative_path: str) -> bool:
    """파일 수정/읽기 허용 여부.
    경로 traversal 방어 + BLOCKED 우선 + ALLOWED prefix 매칭.
    """
    # 정규화 — Windows 백슬래시 대응
    rel = relative_path.replace("\\", "/").strip()
    if not rel or rel.startswith("/"):
        return False
    # 경로 traversal 차단
    if ".." in rel.split("/"):
        return False
    # BLOCKED prefix 우선
    for prefix in BLOCKED_PREFIXES:
        if rel.startswith(prefix):
            return False
    # 정확한 차단 파일
    for blocked in BLOCKED_FILES:
        if rel == blocked:
            return False
    # ALLOWED 디렉터리 시작 여부
    for allowed in ALLOWED_DIRS:
        if rel.startswith(allowed):
            return True
    return False


def build_system_prompt() -> str:
    return f"""당신은 학교 통합 플랫폼의 AI 개발자입니다.
관리자가 기능 추가/수정 요청을 보내면, 코드 변경사항을 생성합니다.

## 역할
- 기존 코드 패턴과 컨벤션을 정확히 따릅니다
- 한국어로 UI 텍스트를 작성합니다
- 최소한의 변경으로 요청을 구현합니다
- 보안에 민감한 파일은 절대 수정하지 않습니다

## 기술 스택
- Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Backend: FastAPI + async SQLAlchemy 2.0 + SQLite/PostgreSQL
- 인증: JWT + TOTP 2FA
- 디자인: CSS 변수 (--bg-primary, --text-primary, --accent 등)

## 수정 가능한 범위
{json.dumps(ALLOWED_DIRS, ensure_ascii=False, indent=2)}

## 수정 불가 파일
{json.dumps(BLOCKED_FILES, ensure_ascii=False, indent=2)}

## 응답 형식 (JSON만 출력)

```json
{{
  "summary": "변경사항 요약 (한국어, 1-3문장)",
  "changes": [
    {{
      "file_path": "frontend/src/app/example/page.tsx",
      "action": "create",
      "content": "파일 전체 내용"
    }},
    {{
      "file_path": "backend/app/main.py",
      "action": "modify",
      "search": "수정할 기존 코드",
      "replace": "새 코드"
    }},
    {{
      "file_path": "backend/app/main.py",
      "action": "modify",
      "modifications": [
        {{"search": "기존 코드 1", "replace": "새 코드 1"}},
        {{"search": "기존 코드 2", "replace": "새 코드 2"}}
      ]
    }}
  ],
  "notes": "관리자에게 전달할 안내사항 (선택)"
}}
```
"""


def build_user_message(
    prompt: str,
    request_type: str,
    additional_context: str | None = None,
    referenced_files: dict[str, str] | None = None,
) -> str:
    parts = [f"## 요청 유형: {request_type}\n\n## 요청 내용\n\n{prompt}"]
    if additional_context:
        parts.append(f"\n\n## 추가 컨텍스트\n\n{additional_context}")
    if referenced_files:
        parts.append("\n\n## 참조 파일")
        for path, content in referenced_files.items():
            parts.append(f"\n### {path}\n```\n{content}\n```")
    return "\n".join(parts)


async def call_claude_api(
    system_prompt: str,
    user_message: str,
    api_key: str,
    model: str = "claude-sonnet-4-20250514",
) -> dict:
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 16000,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}],
            },
        )
        response.raise_for_status()
        data = response.json()

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text += block["text"]

    json_text = text.strip()
    if json_text.startswith("```"):
        lines = json_text.split("\n")
        start = 1
        end = len(lines) - 1
        for i, line in enumerate(lines):
            if line.strip().startswith("```") and i > 0:
                end = i
                break
        json_text = "\n".join(lines[start:end])

    result = json.loads(json_text)
    result["changes"] = [c for c in result.get("changes", []) if is_path_allowed(c.get("file_path", ""))]
    return result


def extract_referenced_files(prompt: str) -> dict[str, str]:
    files = {}
    pattern = r"((?:frontend|backend)/\S+\.(?:tsx?|py|ts|css|json))"
    matches = re.findall(pattern, prompt)
    for path in matches[:10]:
        content = read_file_safe(path)
        if content:
            files[path] = content
    return files


def needs_backend_restart(changes: list[dict]) -> bool:
    return any(c.get("file_path", "").startswith("backend/") for c in changes)


def apply_changes(changes: list[dict]) -> list[dict]:
    results = []
    for change in changes:
        file_path = change.get("file_path", "")
        action = change.get("action", "")
        full_path = PROJECT_ROOT / file_path

        if not is_path_allowed(file_path):
            results.append({"file_path": file_path, "status": "skipped", "reason": "허용되지 않은 경로"})
            continue
        try:
            if action == "create":
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(change["content"], encoding="utf-8")
                results.append({"file_path": file_path, "status": "created"})
            elif action == "modify":
                if not full_path.exists():
                    results.append({"file_path": file_path, "status": "failed", "reason": "파일이 존재하지 않음"})
                    continue
                content = full_path.read_text(encoding="utf-8")
                modifications = change.get("modifications", [])
                if not modifications and "search" in change:
                    modifications = [{"search": change["search"], "replace": change["replace"]}]
                for mod in modifications:
                    if mod["search"] not in content:
                        results.append({"file_path": file_path, "status": "failed", "reason": f"검색 문자열을 찾을 수 없음"})
                        continue
                    content = content.replace(mod["search"], mod["replace"], 1)
                full_path.write_text(content, encoding="utf-8")
                results.append({"file_path": file_path, "status": "modified"})
            elif action == "delete":
                if full_path.exists():
                    full_path.unlink()
                    results.append({"file_path": file_path, "status": "deleted"})
                else:
                    results.append({"file_path": file_path, "status": "skipped", "reason": "파일이 이미 없음"})
        except Exception as e:
            results.append({"file_path": file_path, "status": "failed", "reason": str(e)})
    return results


def restart_backend():
    try:
        cmd = [sys.executable, "-m", "uvicorn", "app.main:app",
               "--host", "0.0.0.0", "--port", str(os.environ.get("PORT", "8002"))]
        kwargs = {"cwd": str(PROJECT_ROOT / "backend"), "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(cmd, **kwargs)
        return True
    except Exception as e:
        logger.error(f"서버 재시작 실패: {e}")
        return False
