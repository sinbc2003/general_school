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


async def send_email(
    to: str, subject: str, body_text: str, body_html: str | None = None,
) -> None:
    """이메일 발송. asyncio.to_thread로 블로킹 SMTP를 워커 스레드에서 실행.

    SMTP_HOST가 비어있으면 stdout 출력 (dev fallback) — 운영 환경에서는
    반드시 .env에 SMTP 정보 설정.
    """
    if not settings.SMTP_HOST:
        # Dev fallback — 콘솔에 출력만
        print("=" * 60)
        print(f"[EMAIL FALLBACK] SMTP 미설정 — 실제 발송 대신 출력")
        print(f"  To: {to}")
        print(f"  Subject: {subject}")
        print(f"  Body:\n{body_text}")
        print("=" * 60)
        return

    def _send():
        msg = EmailMessage()
        msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body_text)
        if body_html:
            msg.add_alternative(body_html, subtype="html")

        if settings.SMTP_USE_TLS:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
                if settings.SMTP_USER:
                    smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                if settings.SMTP_USER:
                    smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                smtp.send_message(msg)

    try:
        await asyncio.to_thread(_send)
    except Exception as e:
        # 메일 발송 실패는 로그만 — 인증 흐름은 차단하지 않음.
        # 사용자가 메일 못 받으면 다시 시도하거나 관리자 문의.
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
