"""시스템 라우터 — 헬스체크, 감사로그, 메뉴 설정, 카테고리, 사이트 브랜딩, 백업.

분할 구조 (sub-router 패턴):
- router.py — APIRouter + health endpoint + sub-module 등록
- audit.py — 감사 로그 조회 + audit_log 보관 정책 (cleanup, retention)
- menu.py — 메뉴 숨김 설정 + 카테고리 + 교사 열람 범위 정책
- branding.py — 사이트 제목/학교명 + 파비콘 업로드/삭제
- backup.py — 전체 백업 export/restore + 자동 백업 스케줄 + 파일 관리
"""

from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "school": settings.SCHOOL_NAME,
        "version": "1.0.0",
    }


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.system import audit  # noqa: E402, F401
from app.modules.system import menu  # noqa: E402, F401
from app.modules.system import branding  # noqa: E402, F401
from app.modules.system import backup  # noqa: E402, F401
from app.modules.system import onboarding  # noqa: E402, F401
from app.modules.system import updates  # noqa: E402, F401
from app.modules.system import feature_flags  # noqa: E402, F401
