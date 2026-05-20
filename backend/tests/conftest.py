"""Pytest fixtures for backend tests.

테스트 격리 원칙:
- 매 테스트마다 SQLite in-memory DB 새로 생성 (PG 실DB 안 건드림)
- main.py의 lifespan은 우회 (시드는 fixture에서 명시적으로)
- 테스트 끝나면 자동 정리

권한 시스템 fixture:
- super_admin / designated_admin / teacher / staff / student 사용자
- 학기 + enrollment + 직책 템플릿
- AsyncClient (TestClient) — Bearer token 자동 주입
"""

import asyncio
import os
from typing import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine,
)


# 테스트 환경 변수 — config.py 로드 전에 설정 (import 순서 중요)
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-not-production")
os.environ.setdefault("ENCRYPTION_MASTER_KEY", "test-encryption-key-not-production")
os.environ.setdefault("BOOTSTRAP_MODE", "first_signup")


@pytest.fixture(scope="session")
def event_loop():
    """session-scoped event loop (asyncio 기본 function-scoped 회피)."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_engine():
    """매 테스트마다 새 in-memory SQLite engine + 테이블 생성.

    SQLite는 기본적으로 FK 미강제 — connect event로 모든 connection에 PRAGMA 적용.
    """
    from sqlalchemy import event
    from app.core.database import Base
    import app.models  # noqa: F401 — 모델 등록

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_fk(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    """테스트용 AsyncSession. 트랜잭션 자동 commit/rollback."""
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def app_client(db_engine) -> AsyncIterator[AsyncClient]:
    """FastAPI 앱 + AsyncClient. main.py의 get_db dependency를 테스트 DB로 override."""
    from app.main import app
    from app.core.database import get_db

    factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db

    # ASGITransport는 lifespan event를 자동 호출하지 않음 — 별도 처리 불필요.
    # 백업 스케줄러 등 lifespan task가 테스트 환경에서 부작용 일으키지 않음.
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client

    app.dependency_overrides.clear()


# ── 시드 헬퍼 ─────────────────────────────────────────────

async def _seed_permissions_minimal(db: AsyncSession) -> None:
    """테스트용 권한 시드 + grant_default_roles 적용 (운영 환경 재현)."""
    from sqlalchemy import select
    from app.core.permission_registry import collect_defined_permissions
    from app.models.permission import Permission
    from scripts.seed import seed_permissions
    from scripts.grant_default_roles import (
        grant_for_role, STAFF_KEYS, STUDENT_KEYS,
        TEACHER_EXCLUDE_PREFIXES, TEACHER_EXCLUDE_KEYS, TEACHER_INCLUDE_KEYS,
    )

    defined = collect_defined_permissions()
    await seed_permissions(db, defined)

    # 운영 환경과 동일하게 default_roles 자동 부여
    all_keys = set((await db.execute(select(Permission.key))).scalars().all())
    teacher_keys = {
        k for k in all_keys
        if not k.startswith(TEACHER_EXCLUDE_PREFIXES) and k not in TEACHER_EXCLUDE_KEYS
    } | (TEACHER_INCLUDE_KEYS & all_keys)
    await grant_for_role(db, "teacher", teacher_keys)
    await grant_for_role(db, "staff", STAFF_KEYS)
    await grant_for_role(db, "student", STUDENT_KEYS)
    await db.commit()


async def _create_user(
    db: AsyncSession, *,
    email: str, name: str, role: str,
    username: str | None = None,
    password: str = "TestPass123!",
    grade: int | None = None,
    class_number: int | None = None,
    student_number: int | None = None,
) -> "User":
    """테스트 사용자 생성. 운영 흐름과 동일하게 quota 자동 부여."""
    from app.core.auth import hash_password
    from app.core.quota import assign_default_quota
    from app.models.user import User
    user = User(
        email=email, name=name, role=role,
        username=username or email.split("@")[0],
        password_hash=hash_password(password),
        status="approved",
        grade=grade, class_number=class_number, student_number=student_number,
        must_change_password=False,
    )
    assign_default_quota(user)
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


# ── 사용자 fixture ───────────────────────────────────────

@pytest_asyncio.fixture
async def seed_perms(db_session):
    """기본 권한 시드를 한 번 실행."""
    await _seed_permissions_minimal(db_session)
    return True


@pytest_asyncio.fixture
async def super_admin(db_session, seed_perms):
    """super_admin 계정."""
    return await _create_user(
        db_session, email="super@test.local", name="Super Admin",
        role="super_admin",
    )


@pytest_asyncio.fixture
async def designated_admin(db_session, seed_perms):
    return await _create_user(
        db_session, email="da@test.local", name="Designated Admin",
        role="designated_admin",
    )


@pytest_asyncio.fixture
async def teacher_user(db_session, seed_perms):
    return await _create_user(
        db_session, email="teacher@test.local", name="Teacher",
        role="teacher",
    )


@pytest_asyncio.fixture
async def student_user(db_session, seed_perms):
    return await _create_user(
        db_session, email="student@test.local", name="Student",
        role="student", grade=2, class_number=3, student_number=15,
    )


# ── 토큰 헬퍼 ───────────────────────────────────────────

@pytest_asyncio.fixture
async def auth_headers():
    """user 객체를 받아 Authorization 헤더 dict 반환하는 factory."""
    from app.core.auth import create_access_token

    def make(user) -> dict:
        token = create_access_token(user.id, user.role)
        return {"Authorization": f"Bearer {token}"}

    return make
