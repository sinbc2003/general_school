"""확장 시 깨지기 쉬운 보안/권한 invariant를 자동 검증.

이 테스트가 하는 것:
  미래에 새 모듈/router/모델이 추가될 때, 사람이 깜빡할 수 있는 보안 규칙을
  CI가 즉시 잡아낸다. "안전한 default + 명시적 가드 등록" 패턴이 깨지면 fail.

각 invariant:
  1. /api/students/{sid}/* 모든 endpoint는 assert_can_view_student 호출 必
  2. UploadFile 받는 endpoint는 validate_upload 또는 화이트리스트 검증 必
  3. 새 storage section은 files/router.py:_GUARDS에 등록되어야 안 차단됨
  4. 모델에 file_url/file_path/stored_path 컬럼 있으면 files/router.py에서 가드 함수 있어야 함
  5. PERMISSIONS 정의된 sensitive 키워드(grade/score/counsel)는 is_sensitive=True 권장

회귀 시나리오:
  - 새 모듈이 /api/students/{sid}/health 같은 endpoint 만들면서
    assert_can_view_student 호출 잊으면 → 즉시 fail
  - 새 모델이 file_path 컬럼 가지는데 files/router.py 가드 등록 안 하면 → fail
"""

import ast
import re
from pathlib import Path

import pytest


pytestmark = pytest.mark.security


BACKEND_APP = Path(__file__).resolve().parents[1] / "app"
MODULES_DIR = BACKEND_APP / "modules"


# ── invariant 1: student-sensitive endpoint visibility ────


def _find_routes_with_sid(src: str, prefix_filter: str | None = None) -> list[str]:
    """src에서 @router.X("/...{sid}...") path 추출.

    prefix_filter가 주어지면 모듈 router prefix를 함께 결합해 매칭.
    """
    routes: list[str] = []
    for m in re.finditer(r'@router\.(\w+)\(["\']([^"\']+)["\']', src):
        path = m.group(2)
        if "{sid}" in path or "{student_id}" in path:
            routes.append(path)
    return routes


@pytest.mark.security
def test_student_sensitive_endpoints_use_visibility_guard():
    """`/api/students/{sid}/*` prefix를 쓰는 모든 모듈은 assert_can_view_student 호출."""
    # students prefix를 갖는 router.py 또는 sub-module 찾기
    target_modules = []
    for f in MODULES_DIR.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        # router의 prefix가 /api/students인지 확인 (sub-module도 같은 router 공유)
        if "/api/students" not in src:
            continue
        # router.py가 prefix를 가진 모듈만 target
        # 단순 휴리스틱: prefix="/api/students" 가 있거나 portfolio 모듈
        if 'prefix="/api/students"' in src or "portfolio" in str(f):
            target_modules.append(f)

    violations: list[str] = []
    for f in target_modules:
        src = f.read_text(encoding="utf-8")
        routes = _find_routes_with_sid(src)
        if not routes:
            continue
        # visibility 가드 호출 확인
        if "assert_can_view_student" not in src and "visible_student_user_ids" not in src:
            violations.append(
                f"{f.relative_to(BACKEND_APP)}: {len(routes)}개 student-sensitive endpoint "
                f"({routes[:3]}...) 인데 assert_can_view_student 미사용. "
                f"→ 각 endpoint 첫 줄에 await assert_can_view_student(db, user, sid) 추가."
            )

    assert not violations, "\n" + "\n".join(violations)


# ── invariant 2: UploadFile + validate_upload ────────────


@pytest.mark.security
def test_upload_endpoints_use_validate_or_manual_check():
    """UploadFile 받는 endpoint는 validate_upload 또는 명시적 확장자·크기 검증 必.

    예외: file_path 같은 string 입력만 받는 경우 (UploadFile=False)
    """
    violations: list[str] = []
    for f in MODULES_DIR.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        if "UploadFile" not in src:
            continue
        # File(...) 또는 File()로 UploadFile 의존성 사용?
        if "File(" not in src:
            continue
        # validate_upload 또는 manual check 있어야 함
        has_validate = "validate_upload" in src
        has_manual = (
            ("ALLOWED_EXT" in src or "allowed_ext" in src)
            and ("MAX_FILE_SIZE" in src or "max_size" in src.lower())
        )
        if not has_validate and not has_manual:
            violations.append(
                f"{f.relative_to(BACKEND_APP)}: UploadFile 받지만 validate_upload "
                f"또는 ALLOWED_EXT + MAX_FILE_SIZE 검증 누락. "
                f"→ from app.core.upload import validate_upload, POLICY_X 사용 권장."
            )

    assert not violations, "\n" + "\n".join(violations)


# ── invariant 3: storage section 가드 일관성 ────────────


@pytest.mark.security
def test_storage_sections_have_guards():
    """파일 저장 디렉토리 사용처를 모두 files/router.py:_GUARDS에서 처리해야 함.

    회귀: 새 모듈이 storage/newdir/에 파일 저장하면서 files/router.py 가드 등록
    안 하면 사용자가 다운로드 시 403 (안전한 default) — 시스템 깨짐.
    """
    # files/router.py의 _GUARDS dict 키 추출
    files_router = (MODULES_DIR / "files" / "router.py").read_text(encoding="utf-8")
    guarded_sections: set[str] = set()
    for m in re.finditer(r'"(\w[\w\-]*)"\s*:\s*_guard_\w+', files_router):
        guarded_sections.add(m.group(1))
    # 또한 _GUARDS 외에 명시적 처리되는 branding 추가
    guarded_sections.add("branding")

    # 실제 storage/ 하위에 저장하는 디렉토리 찾기
    storage_writes: dict[str, list[str]] = {}
    for f in MODULES_DIR.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        # storage/X 또는 /storage/X 패턴
        for m in re.finditer(r'["\']/?storage/([a-zA-Z][\w\-]*)/', src):
            section = m.group(1)
            storage_writes.setdefault(section, []).append(str(f.relative_to(BACKEND_APP)))

    missing: list[str] = []
    for section, sources in storage_writes.items():
        if section not in guarded_sections:
            missing.append(
                f"section '{section}' (사용처: {sources[:2]}) — "
                f"files/router.py의 _GUARDS dict에 '{section}': _guard_X 등록 必"
            )

    assert not missing, "\n" + "\n".join(missing)


# ── invariant 4: 신규 모델의 file 컬럼 ───────────────────


@pytest.mark.security
def test_file_columns_have_corresponding_guards():
    """모델에 file_url/file_path/stored_path 컬럼이 있으면 files/router.py에서 처리되어야 함.

    회귀: 누군가 새 모델 만들고 파일 컬럼 추가했는데 가드 없으면 다운로드 차단됨 (안전한 default).
    이 테스트는 신규 컬럼이 어디 매칭되는지 추적용. fail하면 _GUARDS 추가 필요.
    """
    files_router = (MODULES_DIR / "files" / "router.py").read_text(encoding="utf-8")

    # 모델 컬럼 패턴 검출
    models_dir = BACKEND_APP / "models"
    file_columns: list[tuple[str, str]] = []  # (모델 파일, 컬럼명)
    for f in models_dir.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        for col in re.findall(r"(file_url|file_path|stored_path)\s*:\s*Mapped", src):
            file_columns.append((f.stem, col))

    # 각 컬럼이 _GUARDS의 어떤 가드 함수에서 select되는지 확인
    # 단순 검증: 컬럼명이 files/router.py 에 등장하면 OK
    weak: list[str] = []
    for model, col in file_columns:
        if col not in files_router:
            weak.append(f"{model}.{col} — files/router.py에서 미처리 가능성")

    # 알려진 OK: file_url (StudentArtifact), stored_path (Assignment/Research/Document),
    # file_path (ClubSubmission)
    # 모두 가드되었으면 weak 빈 list
    assert not weak, "\n".join(weak)


# ── invariant 5: sensitive 권한 키워드 ──────────────────


@pytest.mark.security
def test_sensitive_keywords_marked_2fa_or_sensitive():
    """권한 키 이름이 명백히 sensitive인데 (grade/score/counsel/record) requires_2fa 또는
    is_sensitive 마크 안 된 경우 경고.

    이건 약한 휴리스틱 — false positive 있을 수 있어 권고만 (assert 안 함, print).
    """
    sensitive_words = ["grade", "score", "counsel", "record"]
    suspect: list[str] = []
    for f in MODULES_DIR.rglob("permissions.py"):
        src = f.read_text(encoding="utf-8")
        # PERMISSIONS = [...] 내부 dict들 파싱
        for m in re.finditer(
            r'{\s*"key"\s*:\s*"([^"]+)"[^}]*}',
            src, re.DOTALL,
        ):
            block = m.group(0)
            key = m.group(1)
            if not any(w in key.lower() for w in sensitive_words):
                continue
            if "requires_2fa" not in block and "is_sensitive" not in block:
                suspect.append(f"{f.relative_to(BACKEND_APP)}: '{key}' — 2FA/sensitive 미표시?")

    # 약한 휴리스틱이라 fail 안 시키고 출력만 (CI 노이즈 방지)
    if suspect:
        print("[INFO] sensitive 마크 검토 권장:")
        for s in suspect:
            print(f"  {s}")
