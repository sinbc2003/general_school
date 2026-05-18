"""애플리케이션 설정 — 환경변수 기반 Pydantic Settings"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Database ──
    DATABASE_URL: str = "sqlite+aiosqlite:///general_school.db"

    # ── Redis ──
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── MeiliSearch ──
    MEILISEARCH_URL: str = "http://localhost:7700"
    MEILISEARCH_MASTER_KEY: str = "masterkey"

    # ── 보안 ──
    JWT_SECRET: str = "change-this-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ENCRYPTION_MASTER_KEY: str = "change-this-in-production"

    # ── 학교 정보 (일반 학교용) ──
    SCHOOL_NAME: str = "학교 이름"
    SCHOOL_SHORT: str = "SCHOOL"
    SITE_LOGO_PATH: str = "/static/logo.png"
    PRIMARY_COLOR: str = "#1a56db"

    # ── 최고관리자 부트스트랩 ──
    # "first_signup" (기본): 첫 회원가입자가 자동으로 super_admin (OpenWebUI 방식)
    # "env_seed":            아래 값으로 시드 시 자동 생성
    BOOTSTRAP_MODE: str = "first_signup"
    SUPER_ADMIN_USERNAME: str = "admin"
    SUPER_ADMIN_PASSWORD: str = "ChangeMe!2026"
    SUPER_ADMIN_EMAIL: str = "admin@school.local"

    # ── URL ──
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8002"

    # ── CORS 허용 origin (콤마 구분).
    # dev: 기본값으로 충분. production: 학교 도메인만 화이트리스트.
    # 예: "https://school.example.com,http://192.168.0.100"
    CORS_ALLOW_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    # ── 2FA ──
    TOTP_ISSUER: str = "General School Platform"
    TOTP_SESSION_MINUTES: int = 30

    # ── Email (SMTP) ──
    # 비어있으면 이메일 발송 대신 stdout에 코드 표시 (dev fallback).
    # 학교 운영: Gmail App Password 또는 학교 메일 서버.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""           # 발신자 표시. 비우면 SMTP_USER 사용
    SMTP_USE_TLS: bool = True

    # ── 이메일 2FA 정책 ──
    # 신뢰 장치 만료 (일). 디폴트 30일.
    TRUSTED_DEVICE_DAYS: int = 30
    # 로그인 챌린지 만료 (분). 디폴트 10분.
    LOGIN_CHALLENGE_MINUTES: int = 10
    # 코드 입력 최대 시도 횟수.
    LOGIN_CHALLENGE_MAX_ATTEMPTS: int = 5

    # ── AI ──
    ANTHROPIC_API_KEY: str = ""

    # ── 텔레그램 ──
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # ── 기본 비밀번호 (엑셀 임포트 시 비밀번호 미입력 시) ──
    DEFAULT_USER_PASSWORD: str = "school1234!"


settings = Settings()
