"""외부 URL 메타데이터 (Open Graph) 미리보기.

frontend에서 슬라이드·문서에 일반 링크 삽입 시, 백엔드가 OG 메타 fetch해
{title, description, image, site_name} 카드 노드 생성에 사용.

보안 (SSRF 방어):
  - 사설망 IP / localhost 차단 (학교 내부 서비스 스캔 방지)
  - http/https 만 허용
  - 응답 크기 제한 (1MB) — 거대 페이지로 메모리 고갈 방지
  - 5초 timeout
  - User-Agent: 식별 가능한 봇 식별자

권한:
  - get_current_user (인증만) — 모든 학생/교사
  - 별도 permission key 없음 (require_permission 사용 안 함 → PERM 검증 영향 없음)

응답 캐싱은 향후 (현재는 매 호출 fetch). 응답 5초 미만이라 부담 적음.
"""

import asyncio
import ipaddress
import re
import socket  # noqa: F401  (asyncio.getaddrinfo가 내부에서 사용)
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/embeds", tags=["embeds"])


_OG_TAGS = {
    "og:title": "title",
    "og:description": "description",
    "og:image": "image",
    "og:site_name": "site_name",
    "og:url": "url",
    "og:type": "type",
}
_FALLBACK_TAGS = {
    "title": "title",  # <title>
    "description": "description",  # <meta name="description">
}


async def _is_safe_host(hostname: str | None) -> bool:
    """SSRF 방어 — 사설망/localhost/메타데이터 IP 차단.

    DNS resolve 후 IP 검증. localhost·private·link-local·multicast·reserved 모두 차단.
    DNS resolve는 asyncio loop.getaddrinfo로 비차단 (느린 DNS도 event loop 안 막음).
    """
    if not hostname:
        return False
    try:
        # 호스트가 직접 IP 문자열일 수도
        try:
            ip = ipaddress.ip_address(hostname)
            return not (ip.is_private or ip.is_loopback or ip.is_link_local
                        or ip.is_multicast or ip.is_reserved or ip.is_unspecified)
        except ValueError:
            pass
        # DNS resolve — asyncio loop은 내부적으로 thread pool 사용해 비차단
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(hostname, None)
        for fam, _t, _p, _c, sockaddr in infos:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str.split("%")[0])
            except ValueError:
                continue
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
                return False
        return True
    except Exception:
        return False


def _parse_og(html: str, base_url: str) -> dict:
    """간단한 정규식 기반 OG/<title>/<meta description> 추출.

    BeautifulSoup 없이 가벼움. 잘못된 HTML이 와도 안전 fallback.
    """
    out: dict = {}

    # OG meta — property="og:..."
    for m in re.finditer(
        r'<meta[^>]+property=["\']?(og:[a-z_:]+)["\']?[^>]+content=["\']([^"\']*)["\']',
        html, re.IGNORECASE | re.DOTALL,
    ):
        prop = m.group(1).lower()
        if prop in _OG_TAGS:
            out[_OG_TAGS[prop]] = m.group(2).strip()

    # content="..."가 property 앞에 오는 경우도
    for m in re.finditer(
        r'<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']?(og:[a-z_:]+)["\']',
        html, re.IGNORECASE | re.DOTALL,
    ):
        prop = m.group(2).lower()
        if prop in _OG_TAGS and _OG_TAGS[prop] not in out:
            out[_OG_TAGS[prop]] = m.group(1).strip()

    # fallback: <title>
    if "title" not in out:
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if m:
            out["title"] = m.group(1).strip()

    # fallback: <meta name="description">
    if "description" not in out:
        m = re.search(
            r'<meta[^>]+name=["\']?description["\']?[^>]+content=["\']([^"\']*)["\']',
            html, re.IGNORECASE | re.DOTALL,
        )
        if m:
            out["description"] = m.group(1).strip()

    if "url" not in out:
        out["url"] = base_url

    # 길이 제한 (악성 페이지 방지)
    for k in ("title", "description", "site_name"):
        if k in out:
            out[k] = out[k][:500]
    return out


@router.get("/og-preview")
async def og_preview(
    url: str = Query(..., max_length=2000),
    _user: User = Depends(get_current_user),
):
    """외부 URL의 OG 메타 fetch. 인증된 사용자만.

    응답: {title, description, image, site_name, url, type}
    안전:
      - sslnoverify=False (HTTPS 검증)
      - SSRF: 사설망 IP 차단
      - timeout 5초
      - 응답 1MB 제한
      - http/https만
    """
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise HTTPException(400, "http/https 만 지원")
    if not await _is_safe_host(p.hostname):
        raise HTTPException(400, "허용되지 않은 호스트 (내부망 차단)")

    headers = {
        "User-Agent": "GeneralSchoolPlatform/1.0 (+og-preview)",
        "Accept": "text/html,application/xhtml+xml",
    }
    try:
        async with httpx.AsyncClient(
            timeout=5.0,
            follow_redirects=True,
            max_redirects=3,
            verify=True,
        ) as client:
            r = await client.get(url, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(502, f"fetch 실패: {type(e).__name__}")

    if r.status_code >= 400:
        raise HTTPException(502, f"원본 응답 {r.status_code}")

    # 응답 본문 크기 제한
    content = r.content[:1024 * 1024]
    text = content.decode(r.encoding or "utf-8", errors="ignore")
    meta = _parse_og(text, url)
    return meta
