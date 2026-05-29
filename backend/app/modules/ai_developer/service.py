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
    # 개발 가이드 자기 자신 (AI가 자기 컨벤션 못 바꾸게)
    "CLAUDE.md",
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


def _load_project_guide() -> str:
    """CLAUDE.md(개발 가이드)를 AI 시스템 프롬프트에 자동 첨부.

    실패 시 빈 문자열 (시스템 프롬프트는 fallback). CLAUDE.md가 작아질 수 있어
    경로 traversal·크기 제한 적용.
    """
    guide_path = PROJECT_ROOT / "CLAUDE.md"
    try:
        text = guide_path.read_text(encoding="utf-8")
        # 80KB 제한 (CLAUDE.md 평소 ~30KB)
        if len(text) > 80_000:
            text = text[:80_000] + "\n\n... (이하 생략 — 전문은 git에서 확인)"
        return text
    except Exception as e:
        logger.warning(f"CLAUDE.md 로드 실패: {e}")
        return ""


def build_system_prompt() -> str:
    """AI에게 프로젝트 컨벤션 + 보안 규칙 + 응답 형식 안내.

    핵심: CLAUDE.md를 그대로 첨부해 AI가 다음을 알게 함:
      - 새 모델 추가 시 __init__.py 등록 의무
      - student-sensitive endpoint에 assert_can_view_student 호출 의무
      - 파일 업로드에 validate_upload + POLICY_X 사용
      - 새 storage section은 files/router.py에 가드 등록
      - 새 권한 키는 permissions.py에 정의 (안 하면 부팅 실패)
      - downloadSecure() 헬퍼만 사용
      - convention test가 매 CI에서 검증
    """
    guide = _load_project_guide()
    guide_section = (
        f"## 프로젝트 개발 가이드 (CLAUDE.md 전문 — 이 규칙 위반 시 CI에서 fail)\n\n{guide}\n\n"
        if guide else ""
    )
    return f"""당신은 학교 통합 플랫폼의 AI 개발자입니다.
관리자가 기능 추가/수정 요청을 보내면, 코드 변경사항을 생성합니다.

## 역할
- 기존 코드 패턴과 컨벤션을 정확히 따릅니다
- 한국어로 UI 텍스트를 작성합니다
- 최소한의 변경으로 요청을 구현합니다
- 보안에 민감한 파일은 절대 수정하지 않습니다
- **CLAUDE.md의 모든 보안·확장 규칙을 지킵니다** (특히 "새 기능 추가 체크리스트")

## 기술 스택
- Frontend: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Backend: FastAPI + async SQLAlchemy 2.0 + PostgreSQL (dev/prod 동일)
- 인증: JWT + TOTP 2FA + 이메일 2FA (교사)
- 디자인: CSS 변수 (--bg-primary, --text-primary, --accent 등) + cream-* 팔레트

## 수정 가능한 범위
{json.dumps(ALLOWED_DIRS, ensure_ascii=False, indent=2)}

## 수정 불가 파일 (시도해도 차단됨)
{json.dumps(BLOCKED_FILES, ensure_ascii=False, indent=2)}

## 자동 검증되는 invariant (변경 후 CI가 잡음 — 위반 시 자동 rollback 후보)
- `/api/students/{{sid}}/*` endpoint는 `await assert_can_view_student(db, user, sid)` 호출 필수
- `UploadFile` 받는 endpoint는 `validate_upload(file, POLICY_X)` 사용 필수
- 새 storage 디렉토리 사용 시 `app/modules/files/router.py:_GUARDS`에 가드 등록 필수
- 새 권한 키는 `app/modules/X/permissions.py`에 정의 필수 (부팅 시 RuntimeError)
- 새 모델은 `app/models/__init__.py`에 import 등록 + alembic revision 필수
- frontend 파일 다운로드는 `downloadSecure(file_url)` 헬퍼만 사용 (`<a href>` 금지)

## 🛡️ 데이터 보존 절대 규칙 (이거 어기면 학생 데이터 손실)

### DB 스키마 변경 (alembic 마이그레이션)
- ❌ **`op.drop_column` 사용 금지** — 컬럼의 모든 데이터 영구 삭제. 정말 필요하면 관리자에게 명시 요청 + 별도 PR 권장
- ❌ **`op.drop_table` 사용 금지** — 테이블 전체 데이터 영구 삭제
- ❌ **`op.execute("DELETE/UPDATE ...")` 직접 SQL로 데이터 변경 금지**
- ❌ **NOT NULL 컬럼 추가 시 기본값/default 없이 추가 금지** — 기존 row 마이그레이션 실패
- ✅ **새 컬럼은 항상 nullable** (또는 `server_default` 명시) — 기존 데이터 보존
- ✅ **새 테이블 추가는 자유** — 기존 데이터 영향 0
- ✅ **컬럼 이름 변경 필요 시 `op.alter_column(..., new_column_name=...)` 사용** — 데이터 보존하면서 rename
- ⚠️ **컬럼 타입 변경 시 변환 정확히 처리** (예: int → str는 자동 변환 OK, str → int는 데이터에 따라 실패 가능)

### 학교 자체 운영 환경 의식 (충돌 회피)
이 코드는 **학교 자체 서버에서 운영 중**이며, **GitHub과 학교 로컬 git이 동시 변경됨**:
- 학교에서 AI 개발자 통해 수정 → 학교 로컬 git에만 적용 (GitHub push X)
- 신병철님이 GitHub `main` 직접 push
- 자동 업데이트 시 둘이 합쳐짐 (git pull) — **conflict 가능성**

따라서 다음 규칙:
- ✅ **새 파일 추가 우선** — 기존 파일 수정은 conflict 위험
- ⚠️ **기존 파일 수정 시 변경 최소화** — 한 파일에 큰 블록 추가하지 말고 작게
- ❌ **`alembic/versions/` 새 마이그레이션 추가 시 GitHub과 충돌 가능** — 신병철님이 같은 시점에 마이그레이션 만들면 두 head 생김. 관리자에게 "이 마이그레이션을 본부에 PR로 보내야 한다" 명시
- ❌ **`scripts/setup-production.sh`, `production/` 디렉토리 수정 금지** — 배포 시스템 코어
- ❌ **`CLAUDE.md` 자기 수정 금지** (이미 BLOCKED_FILES)
- ✅ **민감 변경 (모델/마이그레이션/권한) 시 `notes`에 "본부 GitHub에 PR로 반영 필요" 명시**

### 변경 후 관리자에게 안내
응답의 `notes` 필드에 다음 중 해당하는 거 명시:
- 마이그레이션 추가했음 → "이 변경은 GitHub 본부에도 반영 권장 (자동 업데이트 충돌 방지)"
- 새 모델/테이블 추가 → "alembic revision 생성 필요 (또는 init_db 우회 가능)"
- 권한 추가 → "재시작 시 자동 시드"

{guide_section}## 응답 형식 (JSON만 출력)

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
  "notes": "관리자에게 전달할 안내사항 (선택, 마이그레이션 명령·재시작 필요 등)"
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
    """프롬프트에 직접 명시된 파일 경로 읽어 첨부 + 모듈 키워드로 자동 첨부.

    예: prompt에 "users 모듈"이 나오면 users/router.py, users/schemas.py 자동 첨부.
    """
    files: dict[str, str] = {}

    # 1) 명시된 파일 경로
    pattern = r"((?:frontend|backend)/\S+\.(?:tsx?|py|ts|css|json))"
    matches = re.findall(pattern, prompt)
    for path in matches[:10]:
        content = read_file_safe(path)
        if content:
            files[path] = content

    # 2) 모듈 키워드 자동 첨부 — "X 모듈", "/api/X/" 패턴
    module_pattern = r"(?:^|\s|/)([a-z_]+)(?:\s*모듈|\s*module|/api/[a-z]+)"
    module_names = set(re.findall(module_pattern, prompt))
    # 알려진 모듈만 (오탐 방지)
    known_modules = {
        "auth", "users", "permissions", "system", "archive", "pipeline", "contest",
        "assignment", "papers", "timetable", "research", "club", "admissions",
        "portfolio", "challenge", "feedback", "ai_developer", "chatbot",
        "student_self", "announcement", "files",
    }
    for mod in module_names & known_modules:
        for sub in ("router.py", "schemas.py", "permissions.py"):
            path = f"backend/app/modules/{mod}/{sub}"
            if path in files:
                continue
            content = read_file_safe(path)
            if content:
                files[path] = content
        if len(files) >= 15:
            break

    return files


def run_smoke_tests() -> tuple[bool, str]:
    """적용 후 빠른 회귀 검증 — pytest의 security 마킹 + smoke 테스트만 실행.

    전체 90+개 테스트는 시간 오래 걸려 적용 직후엔 보안 critical만 빠르게.
    반환: (passed, output)
    """
    backend_dir = PROJECT_ROOT / "backend"
    try:
        # pytest 보안 마킹 + smoke 테스트 — 빠른 회귀 검증
        proc = subprocess.run(
            [sys.executable, "-m", "pytest",
             "tests/test_smoke.py",
             "tests/test_convention_invariants.py",
             "tests/test_security_regressions.py",
             "--tb=line", "-q", "--no-header"],
            cwd=str(backend_dir),
            capture_output=True,
            text=True,
            timeout=120,
        )
        ok = proc.returncode == 0
        return ok, (proc.stdout + proc.stderr)[-3000:]
    except subprocess.TimeoutExpired:
        return False, "pytest 타임아웃 (120초 초과)"
    except Exception as e:
        return False, f"pytest 실행 실패: {e}"


def rollback_changes(applied_results: list[dict], backups: dict[str, str]) -> list[dict]:
    """적용된 변경을 원상복구.

    apply_changes 호출 전 백업된 원본 파일 내용으로 되돌림.
    create된 파일은 삭제. modify된 파일은 백업으로 복원.
    """
    restored = []
    for r in applied_results:
        path = r.get("file_path", "")
        if not is_path_allowed(path):
            continue
        full_path = PROJECT_ROOT / path
        try:
            if r.get("status") == "created" and full_path.exists():
                full_path.unlink()
                restored.append({"file_path": path, "rollback": "deleted"})
            elif r.get("status") == "modified" and path in backups:
                full_path.write_text(backups[path], encoding="utf-8")
                restored.append({"file_path": path, "rollback": "restored"})
        except Exception as e:
            restored.append({"file_path": path, "rollback": f"failed: {e}"})
    return restored


def backup_changes(changes: list[dict]) -> dict[str, str]:
    """apply_changes 전에 영향 파일들의 원본 내용 백업 (메모리 in dict)."""
    backups: dict[str, str] = {}
    for c in changes:
        path = c.get("file_path", "")
        action = c.get("action", "")
        if action != "modify":
            continue
        if not is_path_allowed(path):
            continue
        full = PROJECT_ROOT / path
        if full.exists():
            try:
                backups[path] = full.read_text(encoding="utf-8")
            except Exception:
                pass
    return backups


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
