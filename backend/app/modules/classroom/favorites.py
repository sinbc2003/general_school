"""즐겨찾기 강좌 — 클래스룸 메인 페이지 상단 별도 섹션 표시.

엔드포인트:
  POST   /api/classroom/courses/{cid}/favorite     — 즐겨찾기 추가
  DELETE /api/classroom/courses/{cid}/favorite     — 즐겨찾기 제거
  GET    /api/classroom/favorites                  — 본인 즐겨찾기 강좌 id 목록
"""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import Course, User, UserFavoriteCourse
from app.modules.classroom.router import router


@router.get("/favorites")
async def list_favorites(
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    ids = (await db.execute(
        select(UserFavoriteCourse.course_id).where(UserFavoriteCourse.user_id == user.id)
    )).scalars().all()
    return {"course_ids": list(ids)}


@router.post("/courses/{cid}/favorite")
async def add_favorite(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")
    dup = (await db.execute(
        select(UserFavoriteCourse).where(
            UserFavoriteCourse.user_id == user.id,
            UserFavoriteCourse.course_id == cid,
        )
    )).scalar_one_or_none()
    if dup:
        return {"ok": True}
    db.add(UserFavoriteCourse(user_id=user.id, course_id=cid))
    await db.flush()
    return {"ok": True}


@router.delete("/courses/{cid}/favorite")
async def remove_favorite(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    fav = (await db.execute(
        select(UserFavoriteCourse).where(
            UserFavoriteCourse.user_id == user.id,
            UserFavoriteCourse.course_id == cid,
        )
    )).scalar_one_or_none()
    if fav:
        await db.delete(fav)
        await db.flush()
    return {"ok": True}
