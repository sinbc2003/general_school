"""파일 업로드 안전 헬퍼 — 크기·확장자·MIME 검증.

운영 사고 방지:
- 크기 제한 없으면 학생 1명이 수십 GB 업로드해 디스크 채울 수 있음 (DoS)
- 확장자 검증 없으면 .exe / .bat / .php 등 위험 파일이 storage에 저장됨
  (storage는 static serve라 실행은 안 되지만, 학생들 사이 악성파일 배포 채널화 위험)

사용:
    from app.core.upload import validate_upload, FilePolicy, POLICY_IMAGE
    content = await validate_upload(file, POLICY_IMAGE)

새 정책 추가 시 _BUILTIN_POLICIES에 등록.
"""

import io
import os
from dataclasses import dataclass

from fastapi import HTTPException, UploadFile


@dataclass(frozen=True)
class FilePolicy:
    """업로드 정책 — 모듈별로 인스턴스 생성해 사용."""
    name: str                       # 정책 이름 (로그용)
    max_size_bytes: int             # 최대 크기 (예: 50 * 1024 * 1024 = 50MB)
    allowed_extensions: frozenset[str]  # 허용 확장자 (소문자, 점 포함 — '.pdf')
    allowed_mime_prefixes: tuple[str, ...] = ()  # MIME prefix 검증 (예: 'image/')


# ── 기본 정책들 (모듈에서 그대로 import해 사용) ─────────────────────

# 일반 문서 (HWP, PDF, DOCX, PPTX, XLSX) — 학습자료·과제·산출물
POLICY_DOCUMENT = FilePolicy(
    name="document",
    max_size_bytes=50 * 1024 * 1024,  # 50MB
    allowed_extensions=frozenset({
        ".pdf", ".hwp", ".hwpx",
        ".doc", ".docx",
        ".ppt", ".pptx",
        ".xls", ".xlsx",
        ".txt", ".md",
    }),
)

# 이미지 — 프로필 사진, 아바타, 산출물 사진
POLICY_IMAGE = FilePolicy(
    name="image",
    max_size_bytes=10 * 1024 * 1024,  # 10MB
    allowed_extensions=frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}),
    allowed_mime_prefixes=("image/",),
)

# 학생 산출물 — 문서 + 이미지 + zip 허용
POLICY_ARTIFACT = FilePolicy(
    name="artifact",
    max_size_bytes=100 * 1024 * 1024,  # 100MB (영상은 외부 링크 권장)
    allowed_extensions=frozenset({
        ".pdf", ".hwp", ".hwpx",
        ".doc", ".docx",
        ".ppt", ".pptx",
        ".xls", ".xlsx",
        ".txt", ".md",
        ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".zip",
    }),
)

# CSV/엑셀 (일괄 등록용) — 크기 제한 작게
POLICY_CSV = FilePolicy(
    name="csv",
    max_size_bytes=5 * 1024 * 1024,  # 5MB
    allowed_extensions=frozenset({".csv", ".tsv", ".xlsx", ".xls"}),
)

# 백업 ZIP — 시스템 복원용 (큼)
POLICY_BACKUP = FilePolicy(
    name="backup",
    max_size_bytes=2 * 1024 * 1024 * 1024,  # 2GB
    allowed_extensions=frozenset({".zip"}),
)

# 클래스룸 첨부 — 자료/과제에 첨부할 파일. 문서·이미지·간단 zip.
POLICY_CLASSROOM = FilePolicy(
    name="classroom",
    max_size_bytes=50 * 1024 * 1024,  # 50MB (영상은 외부 링크 권장)
    allowed_extensions=frozenset({
        ".pdf", ".hwp", ".hwpx",
        ".doc", ".docx",
        ".ppt", ".pptx",
        ".xls", ".xlsx",
        ".txt", ".md",
        ".png", ".jpg", ".jpeg", ".webp", ".gif",
        ".zip",
    }),
)


# 파비콘 — 작은 이미지
POLICY_FAVICON = FilePolicy(
    name="favicon",
    max_size_bytes=1 * 1024 * 1024,  # 1MB
    allowed_extensions=frozenset({".ico", ".png", ".svg", ".jpg", ".jpeg"}),
    allowed_mime_prefixes=("image/",),
)


# ── 검증 함수 ──────────────────────────────────────────────────

def _human_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / 1024 / 1024:.1f} MB"
    return f"{n / 1024 / 1024 / 1024:.2f} GB"


def check_extension(filename: str | None, policy: FilePolicy) -> str:
    """확장자만 분리해 검증. 통과면 소문자 ext 반환. 실패면 HTTPException."""
    name = (filename or "").strip()
    if not name:
        raise HTTPException(400, "파일명이 비어있습니다")
    ext = os.path.splitext(name)[1].lower()
    if not ext:
        raise HTTPException(
            400,
            f"확장자가 없는 파일은 허용되지 않습니다. "
            f"허용 확장자: {sorted(policy.allowed_extensions)}",
        )
    if ext not in policy.allowed_extensions:
        raise HTTPException(
            400,
            f"허용되지 않은 확장자: {ext}. "
            f"허용: {sorted(policy.allowed_extensions)}",
        )
    return ext


def check_mime(content_type: str | None, policy: FilePolicy) -> None:
    """클라이언트가 보낸 Content-Type 검증 (위조 가능하지만 1차 방어).
    allowed_mime_prefixes가 비어있으면 검증 안 함.
    """
    if not policy.allowed_mime_prefixes:
        return
    ct = (content_type or "").lower().split(";")[0].strip()
    if not ct or not any(ct.startswith(p) for p in policy.allowed_mime_prefixes):
        raise HTTPException(
            400,
            f"허용되지 않은 MIME 타입: {ct}. "
            f"허용 prefix: {policy.allowed_mime_prefixes}",
        )


async def validate_upload(
    file: UploadFile,
    policy: FilePolicy,
) -> bytes:
    """업로드 파일을 검증하고 bytes 반환. 실패 시 HTTPException.

    1. 확장자 검증 (소문자 매칭)
    2. MIME 검증 (정책에 prefix 있으면)
    3. 크기 검증 (스트림 읽으면서 누적)

    크기 검증은 read() 후가 아니라 read() 시점에 끊는 게 안전하지만
    FastAPI/Starlette의 read()는 한번에 읽음. 향후 stream chunk 검증으로 개선 여지.
    """
    check_extension(file.filename, policy)
    check_mime(file.content_type, policy)

    # 한 번에 읽기 (Starlette UploadFile은 SpooledTemporaryFile 기반이라
    # max_size_bytes 이내면 memory, 초과 시 디스크 spill — OOM 위험 적음)
    data = await file.read()
    if len(data) > policy.max_size_bytes:
        raise HTTPException(
            400,
            f"파일 크기 초과: {_human_size(len(data))} > {_human_size(policy.max_size_bytes)} "
            f"({policy.name} 정책)",
        )
    if len(data) == 0:
        raise HTTPException(400, "빈 파일")
    return data


def safe_storage_filename(original_filename: str | None, default_prefix: str = "file") -> str:
    """원본 파일명을 안전한 저장 이름으로 변환 (UUID 권장 — 별도 사용).

    경로 traversal 차단 + 안전한 문자만 허용. 한글 보존.
    """
    import re
    raw = (original_filename or "").strip()
    if not raw:
        return f"{default_prefix}.bin"
    name = os.path.basename(raw)  # 경로 부분 제거
    # ../ 같은 패턴 차단
    name = name.replace("\\", "_").replace("/", "_")
    # 안전 문자만 (한글·영문·숫자·점·하이픈·언더스코어)
    name = re.sub(r"[^\w\.\-가-힣ㄱ-ㅎㅏ-ㅣ]+", "_", name, flags=re.UNICODE)
    if not name or name.startswith("."):
        name = f"{default_prefix}{name}"
    return name[:200]  # 길이 제한
