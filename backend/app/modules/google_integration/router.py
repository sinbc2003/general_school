"""Google OAuth 2.0 + Drive API helper. (sub-modules: export.py)


설계:
  - SchoolConfig에 oauth.google.client_id / client_secret 저장 (암호화)
  - 사용자 1명당 GoogleConnection 1개 (refresh_token 암호화)
  - access_token은 메모리만 (refresh로 즉시 재발급, ~1h TTL)

엔드포인트:
  GET    /api/google/config                  — Client ID/Secret 설정 상태 (admin)
  PUT    /api/google/config                  — Client ID/Secret 등록 (admin)
  GET    /api/google/auth-url                — OAuth 시작 URL 반환
  GET    /api/google/callback                — OAuth callback (Google → us)
  GET    /api/google/me                      — 본인 연결 상태
  DELETE /api/google/me                      — 본인 연결 해제 + token revoke
  GET    /api/google/drive/files             — 본인 Drive 파일 목록 (Drive API proxy)

권한:
  google.integration.configure → admin (client id/secret)
  google.integration.use       → 사용자 본인 (연결/해제/Drive 조회)

scope:
  https://www.googleapis.com/auth/drive.readonly  — Drive 파일 list/메타 읽기
  https://www.googleapis.com/auth/drive.file      — 본 앱이 만든/연 파일만 쓰기
  https://www.googleapis.com/auth/userinfo.email  — 연결 시 이메일 확인
  https://www.googleapis.com/auth/userinfo.profile
"""

from datetime import datetime, timezone
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.encryption import decrypt, encrypt
from app.core.permissions import require_permission
from app.models import GoogleConnection, User
from app.models.setting import SchoolConfig


router = APIRouter(prefix="/api/google", tags=["google"])


# ── 상수 ──────────────────────────────────────────────────────


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
GOOGLE_DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
]


# ── Schemas ───────────────────────────────────────────────────


class GoogleConfigBody(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=500)
    client_secret: str = Field(..., min_length=1, max_length=500)
    redirect_uri: str = Field(..., min_length=1, max_length=500)
    enabled: bool = True


# ── 헬퍼 ──────────────────────────────────────────────────────


async def _get_config(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    if not row or not row.value:
        return None
    if row.encrypted:
        try:
            return decrypt(row.value)
        except Exception:
            return None
    return row.value


async def _set_config(db: AsyncSession, key: str, value: str | None, encrypt_it: bool = False) -> None:
    stored = encrypt(value) if (encrypt_it and value) else value
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    if row:
        row.value = stored
        row.encrypted = encrypt_it
    else:
        db.add(SchoolConfig(key=key, value=stored, encrypted=encrypt_it))
    await db.flush()


async def _is_google_configured(db: AsyncSession) -> bool:
    enabled = await _get_config(db, "oauth.google.enabled")
    cid = await _get_config(db, "oauth.google.client_id")
    return (enabled == "true") and bool(cid)


async def _exchange_refresh_for_access(db: AsyncSession, refresh_token: str) -> str | None:
    """refresh_token으로 access_token 즉시 재발급. 메모리 캐시 X (caller 책임)."""
    cid = await _get_config(db, "oauth.google.client_id")
    cs = await _get_config(db, "oauth.google.client_secret")
    if not cid or not cs:
        raise HTTPException(503, "Google OAuth가 설정되지 않았습니다")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": cid,
            "client_secret": cs,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    if r.status_code != 200:
        return None
    return r.json().get("access_token")


async def get_access_token_for_user(db: AsyncSession, user: User) -> str:
    """사용자의 GoogleConnection으로 access_token 발급. 호출 시마다 새로 (캐싱은 caller)."""
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == user.id)
    )).scalar_one_or_none()
    if not conn:
        raise HTTPException(401, "Google 계정이 연결되지 않았습니다")
    try:
        refresh = decrypt(conn.refresh_token_encrypted)
    except Exception:
        raise HTTPException(500, "토큰 복호화 실패 (재연결 필요)")
    access = await _exchange_refresh_for_access(db, refresh)
    if not access:
        raise HTTPException(401, "토큰 갱신 실패 (다시 연결하세요)")
    return access


# ── Admin config endpoints ────────────────────────────────────


@router.get("/config")
async def get_google_config(
    user: User = Depends(require_permission("google.integration.configure")),
    db: AsyncSession = Depends(get_db),
):
    cid = await _get_config(db, "oauth.google.client_id")
    enabled = await _get_config(db, "oauth.google.enabled")
    redirect = await _get_config(db, "oauth.google.redirect_uri")
    return {
        "configured": bool(cid),
        "enabled": enabled == "true",
        "client_id_preview": (cid[:8] + "..." + cid[-4:]) if cid and len(cid) > 16 else cid,
        "redirect_uri": redirect,
    }


@router.put("/config")
async def update_google_config(
    body: GoogleConfigBody,
    request: Request,
    user: User = Depends(require_permission("google.integration.configure")),
    db: AsyncSession = Depends(get_db),
):
    await _set_config(db, "oauth.google.client_id", body.client_id, encrypt_it=True)
    await _set_config(db, "oauth.google.client_secret", body.client_secret, encrypt_it=True)
    await _set_config(db, "oauth.google.redirect_uri", body.redirect_uri, encrypt_it=False)
    await _set_config(db, "oauth.google.enabled", "true" if body.enabled else "false", encrypt_it=False)
    await log_action(db, user, "google_config_update", request=request)
    return {"ok": True}


# ── OAuth flow ────────────────────────────────────────────────


STATE_TTL_SECONDS = 600  # OAuth state 10분 만료


@router.get("/auth-url")
async def get_auth_url(
    user: User = Depends(require_permission("google.integration.use")),
    db: AsyncSession = Depends(get_db),
):
    """OAuth 시작 URL 반환. frontend가 redirect."""
    if not await _is_google_configured(db):
        raise HTTPException(503, "Google 연동이 설정되지 않았습니다 (관리자에게 문의)")
    cid = await _get_config(db, "oauth.google.client_id")
    redirect_uri = await _get_config(db, "oauth.google.redirect_uri")
    # 진단 로그 — invalid_client 디버깅용. 마스킹 후 출력.
    from app.core.encryption import mask_secret
    print(
        f"[google.oauth] auth-url client_id={mask_secret(cid or '', 10, 8)} "
        f"redirect_uri={redirect_uri} len(cid)={len(cid or '')}",
        flush=True,
    )
    # Google client_id는 보통 `.apps.googleusercontent.com`으로 끝난다 — 강한 힌트.
    if cid and not cid.endswith(".apps.googleusercontent.com"):
        print(
            "[google.oauth] WARN: client_id가 '.apps.googleusercontent.com'으로 끝나지 "
            "않습니다 — Google Cloud Console에서 복사한 값이 잘렸을 가능성. "
            "/system/integrations/google 에서 다시 등록하세요.",
            flush=True,
        )
    # state는 secrets.token_urlsafe만 — user_id 평문 노출 차단
    state = secrets.token_urlsafe(32)
    # SchoolConfig에 value="user_id|timestamp|redirect_uri"로 저장 — callback에서 TTL + redirect 일치 검증
    from datetime import datetime, timezone
    ts = int(datetime.now(timezone.utc).timestamp())
    # `|` 구분자 충돌 방지를 위해 redirect_uri는 b64url encode (URL-safe, no padding 손실 무관)
    import base64
    redirect_b64 = base64.urlsafe_b64encode((redirect_uri or "").encode("utf-8")).decode("ascii")
    await _set_config(db, f"oauth.google.state.{state}", f"{user.id}|{ts}|{redirect_b64}", encrypt_it=False)
    params = {
        "client_id": cid,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",  # refresh_token 받기
        "prompt": "consent",       # 매번 refresh_token 발급 보장
        "state": state,
    }
    return {"url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}


@router.get("/callback")
async def callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Google이 redirect로 호출. code → 토큰 교환 → DB 저장."""
    # state 검증 (TTL + 1회용 + redirect_uri 일치)
    saved = await _get_config(db, f"oauth.google.state.{state}")
    if not saved:
        raise HTTPException(400, "잘못된 state (재시도 필요)")
    # value format: "user_id|timestamp|redirect_b64" (legacy: "user_id|timestamp")
    parts = saved.split("|")
    if len(parts) < 2:
        raise HTTPException(400, "state 형식 오류")
    try:
        user_id = int(parts[0])
        issued_at = int(parts[1])
    except (ValueError, AttributeError):
        raise HTTPException(400, "state 형식 오류")
    saved_redirect: str | None = None
    if len(parts) >= 3:
        import base64
        try:
            saved_redirect = base64.urlsafe_b64decode(parts[2].encode("ascii")).decode("utf-8")
        except Exception:
            raise HTTPException(400, "state redirect_uri decode 실패")
    from datetime import datetime, timezone
    now = int(datetime.now(timezone.utc).timestamp())
    # state 1회용 — 즉시 삭제 (TTL 초과여도 삭제)
    await _set_config(db, f"oauth.google.state.{state}", None, encrypt_it=False)
    if now - issued_at > STATE_TTL_SECONDS:
        raise HTTPException(400, "state 만료 (10분 초과 — 재시도 필요)")

    cid = await _get_config(db, "oauth.google.client_id")
    cs = await _get_config(db, "oauth.google.client_secret")
    redirect_uri = await _get_config(db, "oauth.google.redirect_uri")
    if not all([cid, cs, redirect_uri]):
        raise HTTPException(503, "Google OAuth가 설정되지 않았습니다")

    # redirect_uri 일치 검증 — auth-url 발급 시점과 callback 시점이 동일해야 함.
    # 관리자가 둘 사이에 redirect_uri를 바꾸면 토큰이 의도치 않은 origin으로 발급될 수 있음 (open redirect).
    # Google에 보낼 redirect_uri는 반드시 state에 기록된 값(=auth-url 발급 시점의 admin 설정)과 동일해야 함.
    if saved_redirect is not None and saved_redirect != redirect_uri:
        raise HTTPException(
            400,
            "redirect_uri가 변경되었습니다 — 관리자에게 문의 후 OAuth를 다시 시작하세요",
        )

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": cid,
            "client_secret": cs,
            "code": code,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
    if r.status_code != 200:
        raise HTTPException(400, f"토큰 교환 실패: {r.text[:200]}")
    tok = r.json()
    refresh_token = tok.get("refresh_token")
    access_token = tok.get("access_token")
    if not refresh_token:
        raise HTTPException(400, "refresh_token 미수신 — Google 계정 권한 페이지에서 기존 권한 제거 후 재시도하세요")

    # 사용자 이메일 조회
    async with httpx.AsyncClient(timeout=10) as client:
        ui = await client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    google_email = ui.json().get("email", "") if ui.status_code == 200 else ""

    # 기존 연결 upsert
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "사용자 없음")

    # 같은 google_email이 이미 다른 사용자에게 연결돼있으면 차단 (1 google_email = 1 학교 계정)
    if google_email:
        dup = (await db.execute(
            select(GoogleConnection).where(
                GoogleConnection.google_email == google_email,
                GoogleConnection.user_id != user_id,
            )
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(
                409,
                f"이 Google 계정({google_email})은 이미 다른 학교 계정에 연결되어 있습니다",
            )

    existing = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == user_id)
    )).scalar_one_or_none()
    encrypted = encrypt(refresh_token)
    if existing:
        existing.refresh_token_encrypted = encrypted
        existing.google_email = google_email or existing.google_email
        existing.scope = tok.get("scope")
    else:
        db.add(GoogleConnection(
            user_id=user_id,
            google_email=google_email,
            refresh_token_encrypted=encrypted,
            scope=tok.get("scope"),
        ))
    # User.google_email 업데이트
    if google_email and not user.google_email:
        user.google_email = google_email
    await db.flush()
    await log_action(db, user, "google_connect", detail=f"email={google_email}")

    # frontend로 close window — postMessage origin은 본 서버 자체(opener와 동일 origin) 명시
    from fastapi.responses import HTMLResponse
    return HTMLResponse(
        "<html><body><script>"
        "try { window.opener && window.opener.postMessage({type:'google_connected'}, window.location.origin); } catch(e){}"
        "window.close();"
        "</script>"
        "<p>Google 계정 연결 완료. 이 창은 자동으로 닫힙니다.</p>"
        "</body></html>"
    )


@router.get("/me")
async def my_google_status(
    user: User = Depends(require_permission("google.integration.use")),
    db: AsyncSession = Depends(get_db),
):
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == user.id)
    )).scalar_one_or_none()
    return {
        "connected": bool(conn),
        "google_email": conn.google_email if conn else None,
        "connected_at": conn.created_at.isoformat() if conn else None,
    }


@router.delete("/me")
async def disconnect_my_google(
    request: Request,
    user: User = Depends(require_permission("google.integration.use")),
    db: AsyncSession = Depends(get_db),
):
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.user_id == user.id)
    )).scalar_one_or_none()
    if not conn:
        return {"ok": True}
    # Google에 token revoke 요청 (best-effort)
    try:
        refresh = decrypt(conn.refresh_token_encrypted)
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(GOOGLE_REVOKE_URL, data={"token": refresh})
    except Exception:
        pass
    await db.delete(conn)
    await db.flush()
    await log_action(db, user, "google_disconnect", request=request)
    return {"ok": True}


# ── Drive API proxy ───────────────────────────────────────────


@router.get("/drive/files")
async def list_drive_files(
    q: str | None = Query(None, description="Drive 검색 쿼리 (예: name contains 'foo')"),
    page_token: str | None = None,
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(require_permission("google.integration.use")),
    db: AsyncSession = Depends(get_db),
):
    """본인 Drive 파일 목록 조회 — Drive API v3 proxy."""
    access = await get_access_token_for_user(db, user)
    params = {
        "pageSize": page_size,
        "fields": "files(id,name,mimeType,iconLink,webViewLink,modifiedTime,size,thumbnailLink),nextPageToken",
        "orderBy": "modifiedTime desc",
    }
    if q:
        params["q"] = q
    if page_token:
        params["pageToken"] = page_token
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(GOOGLE_DRIVE_FILES_URL, params=params, headers={"Authorization": f"Bearer {access}"})
    if r.status_code != 200:
        raise HTTPException(502, f"Drive API 호출 실패: {r.status_code}")
    return r.json()

# Sub-modules
from app.modules.google_integration import export  # noqa: E402, F401
