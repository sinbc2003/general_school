"""메뉴 숨김 설정 + 메뉴 카테고리 + 교사 열람 범위 정책.

router 객체는 router.py에서 공유. router.py 끝의 'from . import menu'로 등록.
"""

import json

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_admin, require_super_admin
from app.core.visibility import set_view_scope, get_view_scope
from app.models.setting import Setting
from app.models.user import User
from app.modules.system.schemas import MenuSettingsUpdate, TeacherViewScopeUpdate

from app.modules.system.router import router


HIDDEN_MENUS_KEY = "hidden_menus"
MENU_CATEGORIES_KEY = "menu_categories"


# ── 메뉴 숨김 설정 ──

@router.get("/menu-settings")
async def get_menu_settings(
    db: AsyncSession = Depends(get_db),
):
    """숨겨진 메뉴 목록 반환 (인증 불필요 — 메뉴 렌더링에 필요)"""
    row = (await db.execute(
        select(Setting).where(Setting.key == HIDDEN_MENUS_KEY)
    )).scalar_one_or_none()
    hidden = json.loads(row.value) if row and row.value else []
    return {"hidden_menus": hidden}


@router.put("/menu-settings")
async def update_menu_settings(
    body: MenuSettingsUpdate,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """메뉴 숨김 설정 변경 (관리자 — super_admin + designated_admin)"""
    hidden = body.hidden_menus
    row = (await db.execute(
        select(Setting).where(Setting.key == HIDDEN_MENUS_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = json.dumps(hidden)
    else:
        row = Setting(key=HIDDEN_MENUS_KEY, value=json.dumps(hidden))
        db.add(row)
    await db.flush()
    return {"ok": True, "hidden_menus": hidden}


# ── 메뉴 카테고리 관리 ──

class CategoryItem(BaseModel):
    id: str
    name: str
    icon: str
    items: list[str]


class CategoriesBody(BaseModel):
    admin: list[CategoryItem]
    student: list[CategoryItem]


@router.get("/menu-categories")
async def get_menu_categories(
    db: AsyncSession = Depends(get_db),
):
    """메뉴 카테고리 반환 (인증 불필요 — 사이드바 렌더링에 필요)"""
    row = (await db.execute(
        select(Setting).where(Setting.key == MENU_CATEGORIES_KEY)
    )).scalar_one_or_none()
    if row and row.value:
        return json.loads(row.value)
    return None


@router.put("/menu-categories")
async def update_menu_categories(
    body: CategoriesBody,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """메뉴 카테고리 저장 (관리자 — super_admin + designated_admin)"""
    payload = body.model_dump()
    row = (await db.execute(
        select(Setting).where(Setting.key == MENU_CATEGORIES_KEY)
    )).scalar_one_or_none()
    if row:
        row.value = json.dumps(payload)
    else:
        row = Setting(key=MENU_CATEGORIES_KEY, value=json.dumps(payload))
        db.add(row)
    await db.flush()
    return {"ok": True, **payload}


# ── 교사 열람 범위 정책 ──

@router.get("/policy/teacher-view-scope")
async def get_teacher_view_scope(
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """교사가 학생을 어디까지 열람할 수 있는지의 정책 조회."""
    return {
        "scope": await get_view_scope(db),
        "options": [
            {"value": "all", "label": "모든 학생 열람 (기본)"},
            {"value": "scoped", "label": "담당 학생만 (담임/부담임 + 수업 학년·학급)"},
        ],
    }


@router.put("/policy/teacher-view-scope")
async def update_teacher_view_scope(
    body: TeacherViewScopeUpdate,
    user: User = Depends(require_super_admin()),
    db: AsyncSession = Depends(get_db),
):
    """정책 변경 — 'all' or 'scoped'."""
    scope = body.scope
    await set_view_scope(db, scope)
    await db.flush()
    return {"ok": True, "scope": scope}
