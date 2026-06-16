"""업무 도구 설정 — Mathpix API 키 저장/조회 (SchoolConfig + Fernet).

google_integration 의 _get_config/_set_config 패턴을 그대로 따른다.
키:
  - mathpix.app_id   (평문 — App ID는 비밀 아님)
  - mathpix.app_key  (Fernet 암호화)
  - mathpix.enabled  (평문 "true"/"false")
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt, encrypt
from app.models.setting import SchoolConfig


async def get_config(db: AsyncSession, key: str) -> str | None:
    row = (
        await db.execute(select(SchoolConfig).where(SchoolConfig.key == key))
    ).scalar_one_or_none()
    if not row or not row.value:
        return None
    if row.encrypted:
        try:
            return decrypt(row.value)
        except Exception:
            return None
    return row.value


async def set_config(
    db: AsyncSession, key: str, value: str | None, encrypt_it: bool = False
) -> None:
    stored = encrypt(value) if (encrypt_it and value) else value
    row = (
        await db.execute(select(SchoolConfig).where(SchoolConfig.key == key))
    ).scalar_one_or_none()
    if row:
        row.value = stored
        row.encrypted = encrypt_it
    else:
        db.add(SchoolConfig(key=key, value=stored, encrypted=encrypt_it))
    await db.flush()


async def get_mathpix_keys(db: AsyncSession) -> tuple[str | None, str | None]:
    return (
        await get_config(db, "mathpix.app_id"),
        await get_config(db, "mathpix.app_key"),
    )


async def is_mathpix_configured(db: AsyncSession) -> bool:
    app_id, app_key = await get_mathpix_keys(db)
    return bool(app_id and app_key)


async def is_mathpix_enabled(db: AsyncSession) -> bool:
    # 기본값 True — 키만 등록돼 있으면 활성으로 간주 (명시적 false일 때만 비활성)
    val = await get_config(db, "mathpix.enabled")
    return val != "false"
