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
from pathlib import Path


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
