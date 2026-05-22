"""파일 IO 비동기 헬퍼.

배경: FastAPI는 single-thread async. `Path.write_bytes()`, `open(..., "wb")`, `mkdir()`는
모두 동기 IO — async 라우터에서 직접 호출하면 그 워커가 처리 중인 다른 요청도 막힘
(파일 크기가 클수록 길어짐. 50MB 업로드면 100ms+).

여기 헬퍼들은 모두 `asyncio.to_thread`로 위임 — event loop 비차단.

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


async def write_bytes_async(path: Path | str, data: bytes) -> None:
    """파일 쓰기를 thread pool에 위임. str도 허용."""
    await asyncio.to_thread(Path(path).write_bytes, data)


async def ensure_dir_async(path: Path | str) -> None:
    """디렉터리 생성 (parents=True, exist_ok=True)을 thread pool에 위임. str도 허용."""
    p = Path(path)
    await asyncio.to_thread(lambda: p.mkdir(parents=True, exist_ok=True))


async def read_bytes_async(path: Path | str) -> bytes:
    """파일 읽기를 thread pool에 위임. str도 허용."""
    return await asyncio.to_thread(Path(path).read_bytes)


async def unlink_async(path: Path | str, missing_ok: bool = True) -> None:
    """파일 삭제를 thread pool에 위임. 기본은 없어도 OK. str도 허용."""
    p = Path(path)
    def _do():
        try:
            p.unlink()
        except FileNotFoundError:
            if not missing_ok:
                raise
    await asyncio.to_thread(_do)


# ── Storage volume 인지 헬퍼 (Phase 2-Q 통합 1단계) ──
#
# 현재 모든 업로드는 backend/storage/ 고정 디렉터리 사용. 외장 SSD 등 추가
# StorageVolume이 등록돼 있어도 활용 안 됨. 이 헬퍼는 **신규 호출자가 명시적으로
# 사용할 때**만 active volume 경로를 반환 — 기존 호출자(write_bytes_async 등 path
# 직접 받는 헬퍼들)는 변경 없음. 라우팅 통합은 endpoint별 검증 후 별도 단계에서.

# Default storage root — 기존 backend/storage/ 경로 (CWD 기준 relative)
DEFAULT_STORAGE_ROOT = Path("storage")


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
