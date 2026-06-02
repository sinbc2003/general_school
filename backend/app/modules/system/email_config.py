"""이메일(SMTP) 설정 — 최고관리자가 UI에서 SMTP를 구성한다.

학교마다 메일 서버가 다르므로 .env 하드코딩 대신 SchoolConfig(DB)에 저장한다.
비밀번호는 Fernet 암호화(Google OAuth client_secret과 동일 방식). send_email은
core/email.py의 get_effective_smtp()로 DB 설정을 먼저 읽는다(.env 폴백).

엔드포인트 (system router prefix /api/system):
  GET  /email/config  — 현재 설정 조회 (비밀번호는 설정 여부만; 평문 노출 X)
  PUT  /email/config  — 설정 저장 (password 비우면 기존 유지)
  POST /email/test    — 테스트 메일 발송 (실제 도달 확인)

router 객체는 router.py에서 공유. router.py 끝의 'from . import email_config'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.config import settings
from app.core.database import get_db
from app.core.email import get_effective_smtp, send_email
from app.core.encryption import encrypt
from app.core.permissions import require_super_admin
from app.models.setting import SchoolConfig
from app.models.user import User
from app.modules.system.router import router


async def _set_cfg(db: AsyncSession, key: str, value: str | None, encrypt_it: bool = False) -> None:
    stored = encrypt(value) if (encrypt_it and value) else value
    row = (await db.execute(select(SchoolConfig).where(SchoolConfig.key == key))).scalar_one_or_none()
    if row:
        row.value = stored
        row.encrypted = encrypt_it
    else:
        db.add(SchoolConfig(key=key, value=stored, encrypted=encrypt_it))


class SmtpConfigBody(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    password: str | None = None   # None/빈값이면 기존 비밀번호 유지
    from_addr: str = ""
    from_name: str = ""
    use_tls: bool = True


class TestEmailBody(BaseModel):
    to: str | None = None


@router.get("/email/config")
async def get_email_config(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """현재 SMTP 설정 조회. 비밀번호는 절대 평문 반환하지 않고 설정 여부만."""
    cfg = await get_effective_smtp()
    return {
        "host": cfg["host"] or "",
        "port": cfg["port"],
        "user": cfg["user"] or "",
        "from_addr": cfg["from"] or "",
        "from_name": cfg.get("from_name") or "",
        "use_tls": cfg["use_tls"],
        "password_set": bool(cfg["password"]),
        "source": cfg["source"],   # db | env | none
    }


@router.put("/email/config")
async def set_email_config(
    body: SmtpConfigBody, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """SMTP 설정 저장. password가 비어있으면 기존 비밀번호를 유지."""
    await _set_cfg(db, "email.smtp_host", body.host.strip())
    await _set_cfg(db, "email.smtp_port", str(body.port))
    await _set_cfg(db, "email.smtp_user", body.user.strip())
    await _set_cfg(db, "email.smtp_from", (body.from_addr or "").strip())
    await _set_cfg(db, "email.smtp_from_name", (body.from_name or "").strip())
    await _set_cfg(db, "email.smtp_use_tls", "true" if body.use_tls else "false")
    if body.password:
        # Gmail/네이버 등 앱 비밀번호는 'abcd efgh ijkl mnop'처럼 공백과 함께 표시됨.
        # 공백·개행은 비번의 일부가 아니므로 제거 — 공백째 저장 시 535 인증실패의 흔한 원인.
        import re
        pw = re.sub(r"\s+", "", body.password)
        await _set_cfg(db, "email.smtp_password", pw, encrypt_it=True)
    await db.flush()
    await log_action(db, user, "email.smtp_config_updated", target=body.host, request=request, is_sensitive=True)
    return {"ok": True}


@router.post("/email/test")
async def test_email(
    body: TestEmailBody, request: Request,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """테스트 메일 발송 — 설정이 실제로 동작하는지 확인. 기본 수신자는 본인 이메일."""
    to = (body.to or user.email or "").strip()
    if not to:
        raise HTTPException(400, "받는 주소가 없습니다")
    cfg = await get_effective_smtp()
    if not cfg["host"]:
        raise HTTPException(400, "SMTP가 설정되지 않았습니다 (먼저 저장하세요)")
    try:
        await send_email(
            to,
            f"[{settings.SCHOOL_NAME}] SMTP 테스트 메일",
            "이 메일이 보이면 SMTP 설정이 정상입니다.",
            "<p>이 메일이 보이면 <b>SMTP 설정이 정상</b>입니다. 🎉</p>",
        )
    except Exception as e:
        raise HTTPException(502, f"발송 실패: {type(e).__name__}: {str(e)[:200]}")
    await log_action(db, user, "email.smtp_test", target=to, request=request)
    return {"ok": True, "sent_to": to}
