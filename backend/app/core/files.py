"""파일 IO 비동기 헬퍼.

배경: FastAPI는 single-thread async. `Path.write_bytes()`, `open(..., "wb")`, `mkdir()`는
모두 동기 IO — async 라우터에서 직접 호출하면 그 워커가 처리 중인 다른 요청도 막힘
(파일 크기가 클수록 길어짐. 50MB 업로드면 100ms+).

여기 헬퍼들은 모두 `asyncio.to_thread`로 위임 — event loop 비차단.

NFS / 외장 스토리지 보호:
  - 모든 IO에 timeout 적용 (NFS 마운트 끊김 시 OS가 무한 대기할 수 있음 — `soft,timeo=30`
    옵션 안 걸렸으면 더 위험). 타임아웃 시 `StorageUnavailable` raise.
  - 라우터는 try/except StorageUnavailable로 503 응답 권장. catch 안 해도 OSError로 잡힘
    (StorageUnavailable은 OSError 상속).
  - FileNotFoundError, PermissionError 등 정상 OS 에러는 그대로 통과 — wrapping 안 함.

사용:
    from app.core.files import write_bytes_async, ensure_dir_async

    await ensure_dir_async(STORAGE_DIR)
    await write_bytes_async(STORAGE_DIR / name, data)
"""

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)


# ── 타임아웃 (초) ──────────────────────────────────────────────────────────
# NFS 마운트 끊김 / 외장 SSD 분리 시 OS write/read가 무한 hang 가능 → 강제 차단.
# 학교 LAN 1Gbps 기준 50MB 파일 = 0.4초 + NFS overhead 1초. 30초면 충분 + 안전.
# mkdir/unlink는 metadata 작업 = 짧음. 5초면 비정상.
DEFAULT_IO_TIMEOUT_SEC = 30.0
DEFAULT_META_TIMEOUT_SEC = 5.0


class StorageUnavailable(OSError):
    """파일 IO 타임아웃 또는 마운트 끊김.

    OSError 상속이라 기존 except OSError 블록에도 잡힘 (호환). 라우터에서 명시적으로
    catch해 503 응답 줄 수 있음:

        try:
            await write_bytes_async(path, data)
        except StorageUnavailable:
            raise HTTPException(503, "스토리지 일시 장애 — 잠시 후 다시 시도하세요")
    """

    pass


async def _run_with_timeout(coro, timeout: float, op_name: str, path):
    """asyncio.wait_for 래퍼 — 타임아웃 시 StorageUnavailable 변환 + 로깅."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except asyncio.TimeoutError as exc:
        logger.error(
            "files.%s: TIMEOUT after %.1fs on %s — storage hang (NFS unmounted? external SSD detached?)",
            op_name, timeout, path,
        )
        raise StorageUnavailable(
            f"{op_name} timed out after {timeout}s on {path} — storage unavailable"
        ) from exc


async def write_bytes_async(
    path: Path | str, data: bytes, *, timeout: float = DEFAULT_IO_TIMEOUT_SEC,
) -> None:
    """파일 쓰기를 thread pool에 위임. 기본 30초 타임아웃."""
    p = Path(path)
    await _run_with_timeout(
        asyncio.to_thread(p.write_bytes, data),
        timeout=timeout, op_name="write_bytes", path=p,
    )


async def ensure_dir_async(
    path: Path | str, *, timeout: float = DEFAULT_META_TIMEOUT_SEC,
) -> None:
    """디렉터리 생성 (parents=True, exist_ok=True)을 thread pool에 위임. 기본 5초."""
    p = Path(path)
    await _run_with_timeout(
        asyncio.to_thread(lambda: p.mkdir(parents=True, exist_ok=True)),
        timeout=timeout, op_name="ensure_dir", path=p,
    )


async def read_bytes_async(
    path: Path | str, *, timeout: float = DEFAULT_IO_TIMEOUT_SEC,
) -> bytes:
    """파일 읽기를 thread pool에 위임. 기본 30초 타임아웃.

    FileNotFoundError 등 정상 OS 에러는 그대로 전파 — wrapping 안 함.
    """
    p = Path(path)
    return await _run_with_timeout(
        asyncio.to_thread(p.read_bytes),
        timeout=timeout, op_name="read_bytes", path=p,
    )


async def unlink_async(
    path: Path | str, missing_ok: bool = True, *, timeout: float = DEFAULT_META_TIMEOUT_SEC,
) -> None:
    """파일 삭제를 thread pool에 위임. 기본은 없어도 OK. 5초 타임아웃."""
    p = Path(path)
    def _do():
        try:
            p.unlink()
        except FileNotFoundError:
            if not missing_ok:
                raise
    await _run_with_timeout(
        asyncio.to_thread(_do),
        timeout=timeout, op_name="unlink", path=p,
    )


# ── Storage volume 인지 헬퍼 (Phase 2-Q 통합) ──
#
# 두 단계 추상화:
#   1. **DEFAULT_STORAGE_ROOT** = settings.STORAGE_ROOT (env var 기반).
#      모든 endpoint 통일된 root. 학교 NFS 운영 시 STORAGE_ROOT=/mnt/gs-storage 한 줄로 전환.
#   2. **StorageVolume 분산**: 모델에 ``storage_volume_id`` 컬럼 채워진 row만
#      그 볼륨 path 사용. NULL이면 DEFAULT_STORAGE_ROOT.
#      외장 SSD 추가 등 분산 운영 시 활용.
#
# 신규 endpoint 권장: ``save_upload_to_volume_async()`` 한 번 호출 — 위 두 단계 자동 처리.
# 기존 endpoint도 ``DEFAULT_STORAGE_ROOT``를 path 시작점으로 쓰면 NFS 전환은 환경변수만으로 가능.


def _default_storage_root() -> Path:
    """settings.STORAGE_ROOT 기반 default root. 매 호출 (env override 즉시 반영)."""
    from app.core.config import settings
    return Path(settings.STORAGE_ROOT)


# 호환성: 기존 코드의 from app.core.files import DEFAULT_STORAGE_ROOT 지원.
# 모듈 로드 시점 값 — settings 변경 후 재시작 필요.
DEFAULT_STORAGE_ROOT = _default_storage_root()


async def get_storage_root_with_volume(
    db: "AsyncSession", required_bytes: int = 0,
) -> tuple[Path, int | None]:
    """가용한 storage volume 찾아 ``(root_path, volume_id)`` tuple 반환.

    - active StorageVolume이 있고 여유 공간이 있으면 ``(Path(volume.path), volume.id)``
    - 없거나 실패하면 ``(DEFAULT_STORAGE_ROOT, None)`` — fallback

    호출자가 자료 모델의 ``storage_volume_id`` 컬럼을 함께 채우면 추후
    ``files/router.py``가 root 분기 가능 (Phase 2-Q Step 2 marker).

    Args:
        db: 활성 AsyncSession.
        required_bytes: 업로드할 파일 크기 (volume 여유 공간 비교용).

    Returns:
        tuple[Path, int | None] — (root, volume_id). volume_id가 None이면
        DEFAULT_STORAGE_ROOT 사용 의미.
    """
    try:
        from app.modules.storage_volumes.router import pick_volume_for_upload
        volume = await pick_volume_for_upload(db, required_bytes)
        if volume is not None:
            return Path(volume.path), volume.id
    except Exception as exc:
        logger.warning(
            "get_storage_root_with_volume: pick_volume_for_upload failed, fallback: %s",
            exc,
        )
    return DEFAULT_STORAGE_ROOT, None


async def get_storage_root(
    db: "AsyncSession", required_bytes: int = 0,
) -> Path:
    """가용한 storage volume 찾아 root path 반환.

    - active StorageVolume이 있고 여유 공간이 있으면 그 경로 사용
    - 없으면 ``DEFAULT_STORAGE_ROOT`` (backend/storage/) 반환 — fallback

    호환성 보장:
      - 기존 호출 코드는 절대 변경하지 말 것. 모두 ``DEFAULT_STORAGE_ROOT`` 가정 위에서 동작.
      - 새 endpoint나 마이그레이션 단계에서만 이 헬퍼를 명시적으로 호출.
      - file_url 컬럼에 저장되는 path는 section-relative (예: ``artifacts/{id}/{name}``)로
        유지돼야 ``files/router.py``의 ``_GUARDS``가 정상 작동. 이 헬퍼는 root만 결정.

    Args:
        db: 활성 AsyncSession.
        required_bytes: 업로드할 파일 크기 (volume 여유 공간 비교용). 0이면 일반 선택.

    Returns:
        Path — volume 경로 또는 DEFAULT_STORAGE_ROOT.

    실패 시 (DB 오류 등) ``DEFAULT_STORAGE_ROOT``를 반환 — best-effort.
    """
    try:
        # 순환 import 회피 — pick_volume_for_upload가 storage_volumes 라우터에 있고,
        # 그 라우터는 audit/permissions 등을 import하므로 모듈 최상위 import 위험
        from app.modules.storage_volumes.router import pick_volume_for_upload
        volume = await pick_volume_for_upload(db, required_bytes)
        if volume is not None:
            return Path(volume.path)
    except Exception as exc:
        logger.warning(
            "get_storage_root: pick_volume_for_upload failed, fallback to default: %s",
            exc,
        )
    return DEFAULT_STORAGE_ROOT


# ── 통합 업로드 헬퍼 (Phase 2-Q 통합 권장 진입점) ──

async def save_upload_to_volume_async(
    db: "AsyncSession",
    *,
    section: str,
    filename: str,
    data: bytes,
) -> tuple[str, Path, int | None]:
    """업로드 1회 통합 헬퍼 — volume 선택 + 디렉터리 보장 + 파일 쓰기 + used_bytes 갱신.

    신규 endpoint에서 권장 진입점. 기존 endpoint는 점진 전환.

    동작:
      1. ``get_storage_root_with_volume(db, len(data))``로 적절한 volume root + id 선택.
         active volume 없으면 DEFAULT_STORAGE_ROOT, volume_id=None.
      2. ``root / section`` 디렉터리 보장 (mkdir parents=True, exist_ok=True).
      3. ``root / section / filename`` 에 ``write_bytes_async`` (timeout 보호).
      4. volume_id가 있으면 그 ``StorageVolume.used_bytes += len(data)`` 갱신.
         (실패해도 파일 자체는 성공한 상태 — best-effort 회계, 다음 헬스체크에서 보정).

    Args:
        db: 활성 AsyncSession.
        section: storage 하위 분류 (예: "documents", "artifacts/123", "hwps/45"). 슬래시 포함 가능.
        filename: 파일명 (UUID 권장 — 충돌 방지는 호출자 책임).
        data: 파일 바이트.

    Returns:
        tuple[str, Path, int | None]
          - ``relative_path`` — DB에 저장할 section-relative path (예: "documents/abc.pdf").
            ``files/router.py``의 ``_GUARDS`` 호환 유지.
          - ``full_path`` — 디스크 절대 경로 (필요 시 추가 작업용).
          - ``volume_id`` — 사용된 StorageVolume.id 또는 None (DEFAULT_STORAGE_ROOT 사용).

    raises:
        StorageUnavailable — write 30s 초과 (NFS hang 등).
        OSError — 디스크 가득 참, 권한 오류 등.

    사용:
        rel, full, vid = await save_upload_to_volume_async(
            db, section="documents", filename=f"{uuid.uuid4().hex}.pdf", data=content,
        )
        doc.stored_path = rel
        if vid is not None:
            doc.storage_volume_id = vid  # 모델에 컬럼 있을 때만
    """
    size = len(data)
    root, volume_id = await get_storage_root_with_volume(db, required_bytes=size)
    section_dir = root / section
    await ensure_dir_async(section_dir)
    full_path = section_dir / filename
    await write_bytes_async(full_path, data)

    if volume_id is not None:
        # used_bytes 갱신 — best-effort (실패해도 파일 자체는 OK).
        try:
            from sqlalchemy import update as sa_update

            from app.models import StorageVolume

            await db.execute(
                sa_update(StorageVolume)
                .where(StorageVolume.id == volume_id)
                .values(used_bytes=(StorageVolume.used_bytes or 0) + size)
            )
            # flush는 호출자 트랜잭션에 맡김 (autocommit 환경 무관).
        except Exception as exc:
            logger.warning(
                "save_upload_to_volume_async: used_bytes update failed for volume_id=%s: %s",
                volume_id, exc,
            )

    # DB에 저장할 path는 section-relative (root 변경돼도 마이그레이션 가능).
    relative_path = f"{section}/{filename}"
    return relative_path, full_path, volume_id


async def storage_health_check(db: "AsyncSession") -> dict:
    """모든 등록 StorageVolume + DEFAULT_STORAGE_ROOT 상태 진단.

    운영 모니터링용 — 외부에서 ``GET /api/storage/health`` 등으로 호출 가능.
    NFS 마운트가 정상인지, 외장 SSD가 detach됐는지 한 번에 확인.

    Returns:
        {
            "default_root": {"path": str, "ok": bool, "free_bytes": int, ...},
            "volumes": [
                {"id": int, "name": str, "path": str, "status": str,
                 "is_active": bool, "free_bytes": int, ...},
                ...
            ],
            "any_unavailable": bool,  # 한 개라도 비정상이면 True
        }
    """
    import shutil as _shutil

    def _quick_check(path_str: str) -> dict:
        try:
            p = Path(path_str)
            if not p.exists():
                return {"ok": False, "status": "missing"}
            if not p.is_dir():
                return {"ok": False, "status": "not_a_dir"}
            usage = _shutil.disk_usage(path_str)
            return {
                "ok": True, "status": "ok",
                "total_bytes": usage.total,
                "free_bytes": usage.free,
            }
        except Exception as exc:
            return {"ok": False, "status": "error", "error": str(exc)[:200]}

    async def _checked(path_str: str) -> dict:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_quick_check, path_str),
                timeout=DEFAULT_META_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            return {"ok": False, "status": "timeout"}

    # default
    default_path_str = str(DEFAULT_STORAGE_ROOT.resolve())
    default_info = await _checked(default_path_str)
    default_info["path"] = default_path_str

    # volumes
    volumes_out: list[dict] = []
    try:
        from sqlalchemy import select as sa_select

        from app.models import StorageVolume

        rows = (await db.execute(
            sa_select(StorageVolume).order_by(StorageVolume.priority, StorageVolume.id)
        )).scalars().all()
        check_results = await asyncio.gather(*[_checked(v.path) for v in rows])
        for v, info in zip(rows, check_results):
            volumes_out.append({
                "id": v.id, "name": v.name, "path": v.path,
                "is_active": v.is_active,
                "priority": v.priority,
                **info,
            })
    except Exception as exc:
        logger.warning("storage_health_check: volumes query failed: %s", exc)

    any_unavail = (not default_info.get("ok")) or any(
        (not vi.get("ok")) and vi.get("is_active") for vi in volumes_out
    )

    return {
        "default_root": default_info,
        "volumes": volumes_out,
        "any_unavailable": any_unavail,
    }
