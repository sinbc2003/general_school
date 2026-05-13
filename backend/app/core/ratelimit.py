"""간단한 in-memory rate limiter — 로그인 무차별 시도 방어.

production 다중 worker 환경에선 Redis 기반 (예: slowapi)으로 교체 권장.
지금은 4-worker gunicorn 정도까진 worker별로 독립 카운터지만 큰 부담 없음.

사용:
    from app.core.ratelimit import login_rate_limit

    @router.post("/login")
    async def login(request: Request, ...):
        await login_rate_limit(request)
        ...
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


# 클라이언트 IP 기준 최근 시도 시각 deque
_login_attempts: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # reverse proxy (Caddy/nginx) 뒤라면 X-Forwarded-For
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def login_rate_limit(
    request: Request,
    max_attempts: int = 5,
    window_seconds: int = 60,
) -> None:
    """1분에 5회까지. 초과 시 429.

    실패한 시도와 성공한 시도 둘 다 카운트 (단순). 너무 빡빡하면 max_attempts 늘림.
    """
    ip = _client_ip(request)
    now = time.time()
    q = _login_attempts[ip]
    # window 밖 시도 제거
    while q and now - q[0] > window_seconds:
        q.popleft()
    if len(q) >= max_attempts:
        oldest = q[0]
        retry_after = int(window_seconds - (now - oldest)) + 1
        raise HTTPException(
            status_code=429,
            detail=f"로그인 시도가 너무 많습니다. {retry_after}초 후 다시 시도해주세요.",
            headers={"Retry-After": str(retry_after)},
        )
    q.append(now)


def reset_login_rate(request: Request) -> None:
    """로그인 성공 시 카운터 초기화 (선택적 호출)."""
    ip = _client_ip(request)
    _login_attempts.pop(ip, None)
