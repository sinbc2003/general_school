"""애플리케이션 설정 — 환경변수 기반 Pydantic Settings"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # .env에 Settings 미정의 키 있어도 무시 (GITHUB_UPDATE_REPO 같은 서비스 env)
    )

    # ── Database ──
    DATABASE_URL: str = "sqlite+aiosqlite:///general_school.db"

    # ── Redis ──
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── MeiliSearch ──
    MEILISEARCH_URL: str = "http://localhost:7700"
    MEILISEARCH_MASTER_KEY: str = "masterkey"

    # ── 보안 ──
    # JWT_SECRET / ENCRYPTION_MASTER_KEY 디폴트값 그대로 운영하면 보안 0.
    # ENV=production일 때 부팅 시 검증 (main.py lifespan) — 디폴트면 RuntimeError.
    # ENV=dev/test 환경은 경고만 (단일 worker, 외부 접근 차단 가정).
    ENV: str = "dev"  # 'dev' | 'production'
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
    # [임시/데모] true면 2FA 코드를 응답(화면)에 노출 — SMTP/ENV 무관. 시연 편의용.
    # ⚠️ 공개 환경에선 2FA 무력화에 가까우므로 데모 후 반드시 false. 기본 false.
    SHOW_LOGIN_CODE: bool = False

    # ── AI ──
    ANTHROPIC_API_KEY: str = ""

    # ── 텔레그램 ──
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_CHAT_ID: str = ""

    # ── 기본 비밀번호 (엑셀 임포트 시 비밀번호 미입력 시) ──
    DEFAULT_USER_PASSWORD: str = "school1234!"

    # ── Hocuspocus 협업 문서 사이드카 ──
    # backend-hocuspocus가 snapshot POST 시 X-Internal-Token 헤더로 보내는 값.
    # 빈 문자열이면 snapshot endpoint 자체가 503 (서비스 미구성).
    # 운영 환경: 양쪽 .env에 동일한 강한 랜덤 값.
    HOCUSPOCUS_INTERNAL_TOKEN: str = ""

    # ── 파일 저장 root (Phase 2-Q 통합 진입점) ──
    # 기본: backend/storage/ (CWD 기준 relative). 학교 NFS 운영 시 절대경로 override.
    #   예) STORAGE_ROOT=/mnt/gs-storage  (B 노트북 NFS 마운트)
    #       STORAGE_ROOT=/srv/general_school/storage  (외장 SSD)
    # 변경 즉시 모든 신규 업로드가 이 root 하위로 감. 기존 파일도 이 root에 있어야 읽힘.
    # 분산 운영(외장 SSD 추가 등)은 별도 StorageVolume 모델 + storage_volume_id로 처리 —
    # 그 경우 모델이 채워진 row만 그 볼륨, 나머지는 이 STORAGE_ROOT 사용.
    STORAGE_ROOT: str = "storage"


settings = Settings()
