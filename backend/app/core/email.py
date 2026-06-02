"""이메일 발송 헬퍼.

dev fallback: SMTP_HOST 비어있으면 stdout에 이메일 내용 출력 (테스트용).
production: SMTP_HOST/PORT/USER/PASSWORD를 .env에 설정.

지원:
- Gmail: SMTP_HOST=smtp.gmail.com, PORT=587, USE_TLS=true, USER=주소,
  PASSWORD=앱 비밀번호 (https://myaccount.google.com/apppasswords)
- 학교 메일 서버: 학교 IT 부서가 제공하는 SMTP 정보
- 학교에 SMTP 없으면: Gmail 한 개 학교용 계정 만들어 사용
"""

import asyncio
import smtplib
from email.message import EmailMessage

from app.core.config import settings


async def get_effective_smtp() -> dict:
    """SMTP 설정 해석 — DB(SchoolConfig, 학교가 UI에서 설정) 우선, 없으면 .env(settings) 폴백.

    이 덕분에 학교는 SSH·.env 없이 화면에서 SMTP를 설정할 수 있다.
    password는 SchoolConfig에 Fernet 암호화 저장됨.
    """
    cfg = {
        "host": settings.SMTP_HOST,
        "port": settings.SMTP_PORT,
        "user": settings.SMTP_USER,
        "password": settings.SMTP_PASSWORD,
        "from": settings.SMTP_FROM,
        "from_name": getattr(settings, "SMTP_FROM_NAME", ""),
        "use_tls": settings.SMTP_USE_TLS,
        "source": "env" if settings.SMTP_HOST else "none",
    }
    try:
        from sqlalchemy import select
        from app.core.database import async_session_factory
        from app.core.encryption import decrypt
        from app.models.setting import SchoolConfig
        async with async_session_factory() as db:
            rows = (await db.execute(
                select(SchoolConfig).where(SchoolConfig.key.like("email.smtp_%"))
            )).scalars().all()
        m = {r.key: r for r in rows}

        def _v(key: str, enc: bool = False):
            r = m.get(key)
            if not r or not r.value:
                return None
            if enc and r.encrypted:
                try:
                    return decrypt(r.value)
                except Exception:
                    return None
            return r.value

        db_host = _v("email.smtp_host")
        if db_host:
            port = _v("email.smtp_port")
            pw = _v("email.smtp_password", enc=True)
            tls = _v("email.smtp_use_tls")
            user = _v("email.smtp_user") or ""
            cfg.update({
                "host": db_host,
                "port": int(port) if (port and port.isdigit()) else settings.SMTP_PORT,
                "user": user,
                "password": pw if pw is not None else "",
                "from": _v("email.smtp_from") or user,
                "from_name": _v("email.smtp_from_name") or "",
                "use_tls": (tls is None) or (tls.lower() in ("true", "1", "yes")),
                "source": "db",
            })
    except Exception:
        pass
    return cfg


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None,
) -> None:
    """이메일 발송. asyncio.to_thread로 블로킹 SMTP를 워커 스레드에서 실행.

    SMTP 설정은 DB(UI 설정) 우선, 없으면 .env. 둘 다 없으면 stdout 출력(dev fallback).
    """
    cfg = await get_effective_smtp()
    if not cfg["host"]:
        # Dev fallback — 콘솔에 출력만
        print("=" * 60)
        print(f"[EMAIL FALLBACK] SMTP 미설정 — 실제 발송 대신 출력")
        print(f"  To: {to}")
        print(f"  Subject: {subject}")
        print(f"  Body:\n{body_text}")
        print("=" * 60)
        return

    def _send():
        from email.utils import formataddr
        msg = EmailMessage()
        _from_addr = cfg["from"] or cfg["user"]
        _from_name = cfg.get("from_name") or ""
        # 표시 이름 있으면 "○○고등학교 <it@gmail.com>" 형식 (개인메일도 학교로 보임)
        msg["From"] = formataddr((_from_name, _from_addr)) if _from_name else _from_addr
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body_text)
        if body_html:
            msg.add_alternative(body_html, subtype="html")

        if cfg["use_tls"]:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                if cfg["user"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as smtp:
                if cfg["user"]:
                    smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)

    try:
        await asyncio.to_thread(_send)
    except Exception as e:
        # 메일 발송 실패는 로그만 — 인증 흐름은 차단하지 않음.
        print(f"[EMAIL ERROR] {to} → {subject}: {e}")
        raise


async def send_login_code(to: str, name: str, code: str, ip: str | None) -> None:
    """로그인 2FA 코드 메일."""
    subject = f"[{settings.SCHOOL_NAME}] 로그인 인증 코드: {code}"
    body_text = f"""안녕하세요, {name}님.

{settings.SCHOOL_NAME} 학교 플랫폼 로그인 시 사용할 인증 코드입니다:

    {code}

이 코드는 {settings.LOGIN_CHALLENGE_MINUTES}분 동안만 유효합니다.

본인이 시도한 로그인이 아니라면 이 메일을 무시하고 즉시 비밀번호를 변경하세요.

IP: {ip or 'unknown'}
"""
    body_html = f"""<p>안녕하세요, <b>{name}</b>님.</p>
<p>{settings.SCHOOL_NAME} 학교 플랫폼 로그인 시 사용할 인증 코드입니다:</p>
<div style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f5f1e7;padding:16px;border-radius:8px;text-align:center;margin:16px 0;font-family:monospace;">{code}</div>
<p>이 코드는 <b>{settings.LOGIN_CHALLENGE_MINUTES}분</b> 동안만 유효합니다.</p>
<p style="color:#888;font-size:12px;">본인이 시도한 로그인이 아니라면 이 메일을 무시하고 즉시 비밀번호를 변경하세요.<br>IP: {ip or 'unknown'}</p>
"""
    await send_email(to, subject, body_text, body_html)
