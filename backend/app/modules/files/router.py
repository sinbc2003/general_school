"""인증된 파일 서빙 — /storage 직접 노출 차단의 대체.

이전엔 main.py의 `app.mount("/storage", StaticFiles(...))`로 모든 파일이
익명 접근 가능했음. 학생 비공개 산출물·과제 제출물·백업 ZIP까지 외부 노출.

본 모듈로 인증 + 모듈별 권한 가드 통과 후만 파일 서빙.

라우팅:
  GET /api/files/storage/{path:path}
    - path traversal 차단 (.., 절대경로)
    - section(첫 segment) 기반 권한 가드:
      · artifacts: owner OR is_public OR admin OR teacher+visibility
      · 기타(assignments/research/documents): 인증만 (TODO: 모듈별 가드 강화)
    - branding/* 는 main.py에서 별도 익명 mount → 본 라우트 안 거침

Frontend는 `<a href={/storage/...}>` 대신 fetch + blob 패턴 사용:
  lib/api/download.ts의 downloadSecure() 헬퍼.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.visibility import assert_can_view_student
from app.models.student_self import StudentArtifact
from app.models.user import User

router = APIRouter(prefix="/api/files", tags=["files"])

STORAGE_DIR = Path(__file__).resolve().parents[3] / "storage"


@router.get("/storage/{path:path}")
async def serve_storage(
    path: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인증된 사용자에게 storage 파일 서빙 + section별 가드."""
    # path traversal 방어
    if ".." in path or path.startswith("/") or "\\" in path:
        raise HTTPException(400, "유효하지 않은 경로")

    full = (STORAGE_DIR / path).resolve()
    storage_resolved = STORAGE_DIR.resolve()
    try:
        full.relative_to(storage_resolved)
    except ValueError:
        raise HTTPException(400, "경로 위반")

    if not full.exists() or not full.is_file():
        raise HTTPException(404, "파일 없음")

    # section별 권한 가드
    parts = path.split("/", 2)
    section = parts[0] if parts else ""

    if section == "artifacts":
        # /storage/artifacts/{user_id}/{filename}
        # DB lookup으로 권한 검증
        file_url = f"/storage/{path}"
        artifact = (await db.execute(
            select(StudentArtifact).where(StudentArtifact.file_url == file_url)
        )).scalar_one_or_none()
        if not artifact:
            # DB에 없는 orphan 파일 → 404 (file_url 추측 차단)
            raise HTTPException(404)

        if artifact.student_id == user.id:
            pass  # 본인
        elif user.role in ("super_admin", "designated_admin"):
            pass  # 관리자 무제한
        elif artifact.is_public:
            pass  # 공개 산출물 — 모든 인증 사용자 OK
        elif user.role in ("teacher", "staff"):
            # 비공개 + 교사: visibility 가드 (담임/수업 학년 학생만)
            await assert_can_view_student(db, user, artifact.student_id)
        else:
            raise HTTPException(403, "권한 없음")
    elif section == "branding":
        # branding은 main.py에서 별도 익명 mount. 여기 와도 인증만 강제.
        pass
    elif section in ("assignments", "research", "documents", "auto-backups", "club"):
        # 인증된 사용자만 접근. 모듈별 세밀 가드는 향후 강화.
        # (현재) 학생 → 다른 학생의 file_url 추측 시 인증 통과하면 다운로드 가능.
        #        그러나 file_url에 timestamp + 원본명 들어가 무차별 어려움.
        # (TODO) 모듈별 ownership/권한 가드 추가.
        pass
    else:
        # 알 수 없는 section
        raise HTTPException(403)

    return FileResponse(str(full))
