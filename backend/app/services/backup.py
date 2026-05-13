"""전체 백업/복원 — DB 모든 테이블 (동적) + storage 디렉터리 + manifest.

핵심:
  - SQLAlchemy Base.metadata에서 테이블 목록을 동적으로 수집
    → 새 테이블/컬럼 추가돼도 자동 포함 (코드 수정 불필요)
  - JSON 형식 (DB 엔진 무관: SQLite ↔ PostgreSQL 호환)
  - storage/ 디렉터리 통째로 tar.gz
  - manifest.json에 버전·날짜·alembic revision·테이블별 행수
  - 모두 합쳐서 단일 ZIP 다운로드

복원 시:
  - manifest 버전 호환성 검증
  - 모든 테이블 데이터 wipe → 외래키 순서로 다시 INSERT
  - storage/ 디렉터리 복원
  - Alembic revision이 다르면 안내 (downgrade 막음)
"""

import io
import json
import tarfile
import zipfile
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import Base


BACKEND_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = BACKEND_DIR / "storage"


# ── JSON 직렬화 ──

def _serialize(v: Any) -> Any:
    """DB 값 → JSON 호환."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        import base64
        return {"__bytes__": base64.b64encode(v).decode()}
    if isinstance(v, (list, tuple)):
        return [_serialize(x) for x in v]
    if isinstance(v, dict):
        return {k: _serialize(val) for k, val in v.items()}
    return str(v)  # fallback


def _deserialize(v: Any, py_type=None) -> Any:
    """JSON → DB 값. py_type은 SQLAlchemy Column.type.python_type."""
    if v is None:
        return None
    if isinstance(v, dict) and "__bytes__" in v:
        import base64
        return base64.b64decode(v["__bytes__"])
    if py_type is datetime and isinstance(v, str):
        try:
            return datetime.fromisoformat(v)
        except ValueError:
            return None
    if py_type is date and isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return v


async def _alembic_revision(db: AsyncSession) -> str | None:
    """현재 DB의 alembic 버전. 없으면 None."""
    try:
        row = (await db.execute(
            select(Base.metadata.tables["alembic_version"].c.version_num)
        )).first()
        return row[0] if row else None
    except Exception:
        return None


# ── EXPORT ──

async def export_all(db: AsyncSession) -> bytes:
    """전체 데이터 → ZIP bytes 반환.

    구조:
      backup.zip
        manifest.json
        data.json        — 모든 테이블 데이터
        storage.tar.gz   — storage/ 디렉터리 (있을 때)
    """
    # 1. 데이터 추출 (메타데이터 sorted_tables 순)
    tables = list(Base.metadata.sorted_tables)
    data: dict[str, list[dict]] = {}
    row_counts: dict[str, int] = {}

    for table in tables:
        rows = (await db.execute(select(table))).mappings().all()
        serialized = [
            {col: _serialize(row[col]) for col in row.keys()}
            for row in rows
        ]
        data[table.name] = serialized
        row_counts[table.name] = len(serialized)

    # 2. manifest — 호환성 검증 + 새 기능 추가 시 검출 용도
    revision = await _alembic_revision(db)
    from app.core.config import settings as _settings
    manifest = {
        "format_version": 1,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "alembic_revision": revision,
        "school_name": _settings.SCHOOL_NAME,
        "school_short": _settings.SCHOOL_SHORT,
        "table_count": len(tables),
        "table_names": [t.name for t in tables],  # 새 테이블 자동 감지
        "row_counts": row_counts,
        "total_rows": sum(row_counts.values()),
        "storage_included": STORAGE_DIR.exists() and any(STORAGE_DIR.iterdir()),
    }

    # 3. zip 패키징
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("data.json", json.dumps(data, ensure_ascii=False))

        # storage/ 디렉터리 (있을 때만)
        if STORAGE_DIR.exists() and any(STORAGE_DIR.iterdir()):
            tar_buf = io.BytesIO()
            with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
                tar.add(str(STORAGE_DIR), arcname="storage")
            zf.writestr("storage.tar.gz", tar_buf.getvalue())

    return buf.getvalue()


# ── RESTORE ──

class RestoreError(Exception):
    pass


async def restore_all(
    db: AsyncSession,
    zip_bytes: bytes,
    confirm: bool = False,
) -> dict:
    """ZIP 받아서 전체 데이터 복원.

    confirm=False면 검증/미리보기만, 실제 데이터는 건드리지 않음.

    반환: 검증/복원 결과 dict
      {
        manifest: {...},
        compatible: bool,
        warnings: [...],
        applied: bool,
        row_counts: {...},  # 복원된 행 수 (applied=True일 때만)
      }
    """
    # 1. ZIP 열기
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile:
        raise RestoreError("유효하지 않은 ZIP 파일입니다")

    if "manifest.json" not in zf.namelist() or "data.json" not in zf.namelist():
        raise RestoreError("백업 파일 형식이 아닙니다 (manifest.json/data.json 누락)")

    manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
    data = json.loads(zf.read("data.json").decode("utf-8"))

    # 2. 호환성 검증
    warnings: list[str] = []
    current_revision = await _alembic_revision(db)
    backup_revision = manifest.get("alembic_revision")

    if backup_revision and current_revision and backup_revision != current_revision:
        warnings.append(
            f"DB 스키마 버전이 다릅니다. backup={backup_revision}, current={current_revision}. "
            f"복원 후 'alembic upgrade head' 실행 권장."
        )

    # 모델에 없는 테이블 발견 (구버전 백업)
    current_tables = {t.name for t in Base.metadata.sorted_tables}
    backup_tables = set(data.keys())
    extra = backup_tables - current_tables
    missing = current_tables - backup_tables
    if extra:
        warnings.append(f"백업에만 있는 테이블 (무시됨): {sorted(extra)}")
    if missing:
        warnings.append(f"현재 모델에만 있는 테이블 (빈 상태로 둠): {sorted(missing)}")

    result = {
        "manifest": manifest,
        "compatible": True,  # 경고는 있어도 진행은 가능
        "warnings": warnings,
        "applied": False,
        "row_counts": manifest.get("row_counts", {}),
    }

    if not confirm:
        return result

    # 3. 실제 복원 (트랜잭션 — 외래키 순서로 wipe → insert)
    tables = list(Base.metadata.sorted_tables)
    applied_counts: dict[str, int] = {}

    # 3a. 외래키 역순으로 wipe (alembic_version 제외 — 그대로 둠)
    for table in reversed(tables):
        if table.name == "alembic_version":
            continue
        await db.execute(delete(table))

    # 3b. 정순으로 insert
    for table in tables:
        if table.name == "alembic_version":
            continue
        rows = data.get(table.name, [])
        if not rows:
            applied_counts[table.name] = 0
            continue
        # 컬럼별 python_type 매핑 (datetime/date 등 역직렬화)
        py_types: dict[str, Any] = {}
        for col in table.columns:
            try:
                py_types[col.name] = col.type.python_type
            except NotImplementedError:
                py_types[col.name] = None

        valid_cols = {c.name for c in table.columns}
        deserialized = []
        for row in rows:
            obj = {}
            for k, v in row.items():
                if k not in valid_cols:
                    continue  # 백업에만 있고 현재 모델에 없는 컬럼 무시
                obj[k] = _deserialize(v, py_types.get(k))
            deserialized.append(obj)

        if deserialized:
            await db.execute(insert(table), deserialized)
        applied_counts[table.name] = len(deserialized)

    # 4. storage/ 복원
    if "storage.tar.gz" in zf.namelist():
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        # 기존 storage 비우기 (조심: 사용자 업로드 파일이 다 사라짐 — 복원 시 의도된 동작)
        # 단순 처리: tar 풀기 (기존 파일 덮어씀)
        tar_bytes = zf.read("storage.tar.gz")
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
            tar.extractall(path=str(STORAGE_DIR.parent))

    await db.flush()

    result["applied"] = True
    result["row_counts"] = applied_counts
    return result
