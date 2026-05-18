"""비밀번호 정책 — 길이 + 복잡도 규칙.

Setting 키로 학교가 조정 가능:
  password.min_length  : 최소 길이 (디폴트 8)
  password.require_letter  : 영문 1글자 이상 필수 (디폴트 true)
  password.require_digit   : 숫자 1글자 이상 필수 (디폴트 true)
  password.require_symbol  : 특수문자 1글자 이상 필수 (디폴트 false)

학생/교사 일괄 등록 시 초기 비밀번호(=phone)는 검증 우회 (정책상 안전).
변경 후 비밀번호는 모두 정책 통과 필수.
"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import Setting


SETTING_KEYS = {
    "min_length": "password.min_length",
    "require_letter": "password.require_letter",
    "require_digit": "password.require_digit",
    "require_symbol": "password.require_symbol",
}

DEFAULTS = {
    "min_length": 8,
    "require_letter": True,
    "require_digit": True,
    "require_symbol": False,
}


async def _get_setting_value(db: AsyncSession, key: str) -> str | None:
    row = (await db.execute(
        select(Setting).where(Setting.key == key)
    )).scalar_one_or_none()
    return row.value if row else None


async def get_policy(db: AsyncSession) -> dict:
    """현재 정책 dict 반환."""
    result = {}
    for k, setting_key in SETTING_KEYS.items():
        raw = await _get_setting_value(db, setting_key)
        if raw is None:
            result[k] = DEFAULTS[k]
        elif isinstance(DEFAULTS[k], bool):
            result[k] = raw.lower() in ("true", "1", "yes")
        else:
            try:
                result[k] = int(raw)
            except ValueError:
                result[k] = DEFAULTS[k]
    return result


async def set_policy(db: AsyncSession, policy: dict) -> None:
    """정책 부분 수정. None인 키는 건드리지 않음."""
    for k, val in policy.items():
        if val is None:
            continue
        setting_key = SETTING_KEYS.get(k)
        if not setting_key:
            continue
        # min_length 검증
        if k == "min_length":
            try:
                v = int(val)
            except (ValueError, TypeError):
                continue
            if v < 6 or v > 64:
                raise ValueError("min_length는 6~64 범위여야 합니다")
            stored = str(v)
        else:
            stored = "true" if val else "false"
        row = (await db.execute(
            select(Setting).where(Setting.key == setting_key)
        )).scalar_one_or_none()
        if row:
            row.value = stored
        else:
            db.add(Setting(key=setting_key, value=stored))


def _check_password(password: str, policy: dict) -> list[str]:
    """정책 위반 사항 목록을 반환. 빈 리스트면 통과."""
    errors: list[str] = []
    if len(password) < policy["min_length"]:
        errors.append(f"비밀번호는 최소 {policy['min_length']}자 이상이어야 합니다")
    if policy.get("require_letter") and not re.search(r"[A-Za-z]", password):
        errors.append("영문자를 1자 이상 포함해야 합니다")
    if policy.get("require_digit") and not re.search(r"\d", password):
        errors.append("숫자를 1자 이상 포함해야 합니다")
    if policy.get("require_symbol") and not re.search(r"[^A-Za-z0-9\s]", password):
        errors.append("특수문자를 1자 이상 포함해야 합니다")
    return errors


async def validate_password(db: AsyncSession, password: str) -> None:
    """정책 위반 시 ValueError. 통과면 None."""
    policy = await get_policy(db)
    errors = _check_password(password, policy)
    if errors:
        raise ValueError(" · ".join(errors))


async def describe_policy(db: AsyncSession) -> dict:
    """UI에 표시할 정책 요약."""
    policy = await get_policy(db)
    rules: list[str] = [f"최소 {policy['min_length']}자 이상"]
    if policy["require_letter"]:
        rules.append("영문자 포함")
    if policy["require_digit"]:
        rules.append("숫자 포함")
    if policy["require_symbol"]:
        rules.append("특수문자 포함")
    return {**policy, "rules": rules}
