"""승인된 학생 산출물 → StudentArtifact 자동 생성.

사용처:
- PastResearch 승인
- ClubSubmission 승인
- GroupSubmission 승인

원칙:
- file_url 공유 (실 파일 복제 X — storage 절약). 단순히 메타만 StudentArtifact에 등록.
- 이미 student_artifact_id가 있으면 새로 만들지 않고 기존 row만 update.
- best-effort — 실패해도 원 작업(승인)은 막지 않음.
"""

from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student_self import StudentArtifact

log = logging.getLogger(__name__)


async def ensure_student_artifact(
    db: AsyncSession,
    *,
    student_id: int,
    title: str,
    description: str | None = None,
    category: str = "report",
    file_url: str | None = None,
    file_name: str | None = None,
    file_size: int | None = None,
    tags: list[str] | None = None,
    existing_id: int | None = None,
) -> int | None:
    """승인된 산출물을 학생 산출물 갤러리에 등록 (또는 기존 row 업데이트).

    returns: StudentArtifact.id (실패 시 None)
    """
    try:
        if existing_id:
            row = await db.get(StudentArtifact, existing_id)
            if row and row.student_id == student_id:
                row.title = title[:255]
                if description is not None:
                    row.description = description
                row.file_url = file_url
                row.file_name = file_name
                row.file_size = file_size
                row.category = category
                if tags is not None:
                    row.tags = tags
                await db.flush()
                return row.id
            # existing_id가 다른 학생 거이거나 없으면 새로 만듦

        row = StudentArtifact(
            student_id=student_id,
            title=title[:255],
            description=description,
            category=category,
            file_url=file_url,
            file_name=file_name,
            file_size=file_size,
            tags=tags or [],
            is_public=False,
        )
        db.add(row)
        await db.flush()
        return row.id
    except Exception as e:
        log.warning("ensure_student_artifact failed student=%s err=%s", student_id, e)
        return None
