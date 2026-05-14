"""SQLite → PostgreSQL 데이터 이전 스크립트.

기존 SQLite DB의 모든 테이블 행을 새 PostgreSQL DB로 복사한다.

실행:
    cd backend
    source venv/bin/activate
    python -m scripts.migrate_sqlite_to_postgres

옵션:
    SOURCE_URL=...  : 출처 SQLite URL (기본 ./general_school.db)
    TARGET_URL=...  : 대상 PostgreSQL URL (기본 .env의 DATABASE_URL)

흐름:
  1. 출처에서 모든 테이블 행을 dict 형태로 수집
  2. 대상에 Base.metadata.create_all (빈 스키마 생성)
  3. 외래키 순서대로 (sorted_tables) 행 insert
  4. PostgreSQL의 sequence 값을 max(id)+1 로 재설정 (다음 insert가 충돌 안 나게)
"""

import asyncio
import os
import sys
from pathlib import Path

# backend/ 를 path에 추가 (스크립트 단독 실행 위해)
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

# 모델 전체 등록 — sorted_tables 가져오기 위함
import app.models  # noqa: F401
from app.core.database import Base
from app.core.config import settings


SOURCE_URL = os.environ.get("SOURCE_URL", "sqlite+aiosqlite:///general_school.db")
TARGET_URL = os.environ.get("TARGET_URL", settings.DATABASE_URL)


def looks_like_postgres(url: str) -> bool:
    return url.startswith("postgresql")


async def main():
    if not looks_like_postgres(TARGET_URL):
        print(f"[ERROR] TARGET_URL이 PostgreSQL이 아닙니다: {TARGET_URL}")
        print("        .env의 DATABASE_URL을 먼저 PostgreSQL로 바꿔주세요.")
        sys.exit(1)

    print(f"SOURCE : {SOURCE_URL}")
    print(f"TARGET : {TARGET_URL}")
    print()
    confirm = input("위 흐름으로 이전 진행? (yes 입력): ").strip()
    if confirm.lower() != "yes":
        print("취소.")
        return

    src = create_async_engine(SOURCE_URL)
    dst = create_async_engine(TARGET_URL)

    # 1) 대상에 스키마 생성
    print("\n[1/4] 대상 PostgreSQL에 테이블 스키마 생성 (create_all)...")
    async with dst.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    SrcSession = async_sessionmaker(src, expire_on_commit=False)
    DstSession = async_sessionmaker(dst, expire_on_commit=False)

    # 2) 모든 테이블 행 복사
    print("\n[2/4] 데이터 행 복사 (외래키 순서)...")
    total_rows = 0
    skipped_tables = []
    async with SrcSession() as src_db, DstSession() as dst_db:
        for table in Base.metadata.sorted_tables:
            try:
                result = await src_db.execute(select(table))
                rows = result.mappings().all()
                if not rows:
                    print(f"  - {table.name}: (비어있음)")
                    continue
                for row in rows:
                    await dst_db.execute(table.insert().values(**dict(row)))
                print(f"  + {table.name}: {len(rows)} rows")
                total_rows += len(rows)
            except Exception as e:
                print(f"  ! {table.name}: 스킵 ({type(e).__name__}: {e})")
                skipped_tables.append(table.name)
                await dst_db.rollback()
                # 새 session 다시 (rollback 된 상태에서 계속 진행)
                continue
        await dst_db.commit()

    # 3) PostgreSQL sequence 재설정 (autoincrement id의 next value)
    print("\n[3/4] PostgreSQL sequence(autoincrement) 재설정...")
    async with dst.begin() as conn:
        for table in Base.metadata.sorted_tables:
            # id 컬럼이 SERIAL/IDENTITY 인 경우 sequence 이름 = "{table}_id_seq"
            pk_cols = [c for c in table.primary_key.columns if c.autoincrement]
            if not pk_cols:
                continue
            pk = pk_cols[0]
            seq_name = f"{table.name}_{pk.name}_seq"
            try:
                # 현재 최대 id + 1 로 sequence 재설정
                await conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', '{pk.name}'), "
                    f"COALESCE((SELECT MAX({pk.name}) FROM {table.name}), 0) + 1, false)"
                ))
            except Exception as e:
                print(f"  ! {table.name} sequence 재설정 실패: {e}")

    print(f"\n[4/4] 완료. 총 {total_rows} rows 이전.")
    if skipped_tables:
        print(f"      스킵된 테이블 ({len(skipped_tables)}): {skipped_tables}")
    print("\n다음:")
    print("  1) backend 재시작 (start-backend.bat)")
    print("  2) 로그인 + 학생 목록 확인")


if __name__ == "__main__":
    asyncio.run(main())
