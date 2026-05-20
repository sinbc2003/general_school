"""학기 자동 강좌 생성 endpoint — services.course_seed wrapping.

POST /api/classroom/courses/_seed-auto
  body: { semester_id, grade_office, class_homeroom, subject, dry_run }
"""

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import User
from app.modules.classroom.router import router
from app.services.course_seed import seed_courses


class SeedRequest(BaseModel):
    semester_id: int = Field(..., gt=0)
    grade_office: bool = True
    class_homeroom: bool = True
    subject: bool = False
    dry_run: bool = False


@router.post("/courses/_seed-auto")
async def seed_auto(
    body: SeedRequest,
    request: Request,
    user: User = Depends(require_permission("classroom.course.manage")),
    db: AsyncSession = Depends(get_db),
):
    result = await seed_courses(
        db,
        body.semester_id,
        grade_office=body.grade_office,
        class_homeroom=body.class_homeroom,
        subject=body.subject,
        dry_run=body.dry_run,
    )
    if not body.dry_run:
        await log_action(
            db, user, "course_seed",
            target=f"semester:{body.semester_id}",
            detail=f"created={result['total_created']} skipped={result['total_skipped']}",
            request=request,
        )
    return result
