"""CSRF Origin/Referer 검증 (SameSite=Lax 보강용).

배경:
- 본 플랫폼은 cookie 인증 + SameSite=Lax + Bearer JWT를 함께 씁니다.
- SameSite=Lax는 대부분의 cross-site cookie 사용을 차단하지만,
  GET top-level navigation에는 cookie를 보냄 + 일부 corner case가 존재.
- defense-in-depth로 mutating 요청(POST/PUT/PATCH/DELETE)에 대해
  Origin / Referer 헤더가 화이트리스트 origin과 일치하는지 추가 검증합니다.

검증 흐름:
1. safe method (GET/HEAD/OPTIONS) → 통과 (CORS preflight 포함)
2. exempt path (OAuth callback 등 외부 redirect로 들어오는 endpoint) → 통과
   (현재는 모두 GET이라 1번에서 통과되지만, 추후 외부 POST 들어올 가능성에 대비한 정책 자리)
3. X-Internal-Token 헤더 보유 (Hocuspocus → FastAPI snapshot 같은 sidecar 호출)
   → 통과 (해당 endpoint가 토큰 자체를 검증함)
4. 테스트 환경 (ENV=dev/test 이면서 CSRF_ENFORCE 미설정) → 통과 (regression 안전망)
5. 위 어디에도 해당 안 되면 Origin 또는 Referer가 CORS_ALLOW_ORIGINS와 일치해야 함.
   불일치 / 둘 다 없음 → 403.

ENV / 설정:
- dev: 기본적으로 verify_csrf가 통과 (테스트 호환). 강제하려면 CSRF_ENFORCE=1.
- production: ENV=production 이면 무조건 강제.
- CORS_ALLOW_ORIGINS가 비어있거나 wildcard("*")이면 production에서 RuntimeError 가능
  (단, 현재는 경고 후 strict 차단 — 의존 모듈이 부팅 차단할 만큼 critical은 아님).
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from app.core.config import settings


_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# 외부 시스템에서 mutating 호출이 들어올 가능성이 있는 path.
# 현재 시스템에는 해당 endpoint가 없으나(모두 GET callback), 미래 호환용 자리.
_EXEMPT_PATHS: frozenset[str] = frozenset({
    # 예: "/api/google/callback",  # 현재는 GET이라 자동 통과.
})


def _normalize_origin(value: str | None) -> str | None:
    """URL/Origin 문자열에서 'scheme://host[:port]' 형태로 정규화 (소문자).

    유효하지 않으면 None.
    """
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        u = urlparse(raw)
        if not u.scheme or not u.netloc:
            return None
        return f"{u.scheme}://{u.netloc}".lower()
    except Exception:
        return None


def _get_allowed_origins() -> set[str]:
    """CORS_ALLOW_ORIGINS 환경변수에서 화이트리스트 정규화."""
    raw = (settings.CORS_ALLOW_ORIGINS or "").strip()
    if not raw:
        return set()
    parts = [_normalize_origin(p.strip()) for p in raw.split(",")]
    return {p for p in parts if p}


def _is_test_env() -> bool:
    """테스트 또는 dev 환경에서 CSRF_ENFORCE가 명시적으로 켜져있지 않으면 bypass.

    이유: pytest TestClient는 Origin 헤더를 자동 주입하지 않음. dev 단일 worker
    + 외부 접근 차단 가정 하에서는 SameSite=Lax + Bearer JWT로 충분.

    production에서는 ENV=production이라 이 함수가 False 반환 → 무조건 강제.
    """
    env = (settings.ENV or "dev").lower()
    enforce = os.environ.get("CSRF_ENFORCE", "").strip().lower()
    if enforce in ("1", "true", "yes", "on"):
        return False  # 강제 모드 — production 아니어도 검증
    return env != "production"


async def verify_csrf(request: Request) -> None:
    """FastAPI dependency — mutating 요청 CSRF 방어.

    main.py에서 `app = FastAPI(..., dependencies=[Depends(verify_csrf)])` 로 등록.

    Raises:
        HTTPException(403): Origin/Referer 검증 실패
    """
    method = request.method.upper()
    if method in _SAFE_METHODS:
        return

    # exempt path (현재는 비어있지만 미래 호환 자리)
    path = request.url.path
    if path in _EXEMPT_PATHS:
        return

    # Hocuspocus 같은 sidecar 내부 호출 — endpoint가 토큰 자체를 검증함
    if request.headers.get("X-Internal-Token") or request.headers.get("x-internal-token"):
        return

    # 테스트 / dev 환경 bypass (CSRF_ENFORCE=1 면 강제)
    if _is_test_env():
        return

    origin = _normalize_origin(request.headers.get("origin"))
    referer = _normalize_origin(request.headers.get("referer"))
    src = origin or referer

    if not src:
        # Origin/Referer 둘 다 없음 — 브라우저 외 호출 가능 (curl/SDK).
        # 학교 LAN 환경에서도 정상 사용자는 브라우저 → 차단해도 안전.
        raise HTTPException(
            status_code=403,
            detail="CSRF: Origin/Referer 헤더가 없는 mutating 요청은 차단됩니다.",
        )

    allowed = _get_allowed_origins()
    if not allowed:
        # CORS_ALLOW_ORIGINS 미설정 — strict 모드로 차단 (안전한 기본값)
        raise HTTPException(
            status_code=403,
            detail="CSRF: CORS_ALLOW_ORIGINS 미설정 (서버 환경변수 확인).",
        )

    if src not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"CSRF: origin '{src}' is not in allowed list.",
        )
