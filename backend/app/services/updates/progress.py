"""SchoolConfig 기반 진행 상황/결과 저장.

- system.update.progress — 진행 중 업데이트의 단계별 상태 (frontend polling)
- system.update.last_result — 마지막 실행 결과 (성공/실패)
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import SchoolConfig


PROGRESS_KEY = "system.update.progress"
LAST_RESULT_KEY = "system.update.last_result"


async def _get(db: AsyncSession, key: str) -> dict | None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    if not row or not row.value:
        return None
    try:
        return json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return None


async def _set(db: AsyncSession, key: str, value: dict) -> None:
    row = (await db.execute(
        select(SchoolConfig).where(SchoolConfig.key == key)
    )).scalar_one_or_none()
    payload = json.dumps(value, ensure_ascii=False, default=str)
    if row:
        row.value = payload
    else:
        row = SchoolConfig(key=key, value=payload)
        db.add(row)
    await db.flush()


async def get_progress(db: AsyncSession) -> dict | None:
    return await _get(db, PROGRESS_KEY)


async def set_progress(db: AsyncSession, value: dict) -> None:
    await _set(db, PROGRESS_KEY, value)


async def get_last_result(db: AsyncSession) -> dict | None:
    return await _get(db, LAST_RESULT_KEY)


async def set_last_result(db: AsyncSession, value: dict) -> None:
    await _set(db, LAST_RESULT_KEY, value)
