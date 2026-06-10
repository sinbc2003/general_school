import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Path 설정 — backend/ 를 sys.path에 넣어 app.* import 가능하게
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# .env 자동 로드 — 프로젝트 루트의 .env에 DATABASE_URL이 있으면 자동으로 alembic이 사용.
# 그래야 학교에서 'alembic upgrade head' 실행 시 PostgreSQL DSN이 적용됨.
# alembic.ini의 sqlalchemy.url은 sqlite 기본값 (개발 fallback).
try:
    from dotenv import load_dotenv
    # backend/../.env (프로젝트 루트) 우선, 없으면 backend/.env
    for candidate in (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)  # 이미 export된 값은 보존
            break
except ImportError:
    # python-dotenv 미설치 환경에서는 OS env만 사용
    pass

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# DATABASE_URL 환경변수 우선 (alembic.ini의 sqlalchemy.url override)
db_url = os.getenv("DATABASE_URL")
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

# 모든 모델 import → Base.metadata가 완성됨
from app.core.database import Base  # noqa: E402
import app.models  # noqa: F401, E402  ← 모든 모델을 메타데이터에 등록

target_metadata = Base.metadata


def include_object(object, name, type_, reflected, compare_to):
    """autogenerate 안전망 — DB에만 있는(모델에 없는) 인덱스 drop 차단.

    성능 인덱스 다수가 raw-SQL 마이그레이션으로만 생성돼 모델 메타데이터에
    없다. 필터 없이 autogenerate하면 그 인덱스들이 전부 drop 대상으로
    잡힌다 (2026-06-10 실제 발생 — 수동 제거로 회피). 여기서 원천 차단:
    reflected(DB에서 읽힘) && compare_to is None(모델에 대응 없음)인 인덱스는
    비교에서 제외 → drop 명령이 생성되지 않는다. 인덱스 삭제가 정말 필요하면
    수동 마이그레이션으로 명시할 것.
    """
    if type_ == "index" and reflected and compare_to is None:
        return False
    return True

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
