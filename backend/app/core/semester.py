"""학기 컨텍스트 헬퍼

- get_current_semester(db): is_current=True인 학기 1개 반환 (없으면 None)
- get_active_semester_id_or_404(db): 현재 학기 ID 강제 — 학기 격리 모듈(대회/과제/동아리)에서 사용
- resolve_semester_id(body, db): 요청 body에 semester_id 있으면 그걸로, 없으면 현재 학기
- semester_filter(query, model, semester_id, optional=False): 쿼리에 학기 필터 추가
"""

from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.timetable import Semester


async def get_current_semester(db: AsyncSession) -> Semester | None:
    """is_current=True인 학기를 반환 (없으면 None)."""
    return (
        await db.execute(select(Semester).where(Semester.is_current == True).limit(1))
    ).scalar_one_or_none()


async def get_active_semester_id_or_404(db: AsyncSession) -> int:
    """현재 학기 ID 강제 반환. 없으면 400 에러.

    학기 격리 모듈(대회/과제/동아리)에서 데이터 생성/조회 시 사용.
    """
    sem = await get_current_semester(db)
    if not sem:
        raise HTTPException(
            400,
            "현재 학기가 설정되지 않았습니다. 최고관리자가 '학기 관리'에서 현재 학기를 지정해주세요.",
        )
    return sem.id


async def resolve_semester_id(body: dict | None, db: AsyncSession) -> int:
    """요청 body에 semester_id가 있으면 그걸 사용, 없으면 현재 학기로 대체."""
    if body and body.get("semester_id"):
        sid = int(body["semester_id"])
        exists = (
            await db.execute(select(Semester.id).where(Semester.id == sid))
        ).scalar_one_or_none()
        if not exists:
            raise HTTPException(404, f"학기를 찾을 수 없습니다: {sid}")
        return sid
    return await get_active_semester_id_or_404(db)


async def get_semester_by_id_or_404(db: AsyncSession, sid: int) -> Semester:
    s = (
        await db.execute(select(Semester).where(Semester.id == sid))
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "학기를 찾을 수 없습니다")
    return s
