"""강좌 담당 교사(owner + co_teacher) 판정 — router-import-free SSOT.

`app.modules.classroom.teachers.is_course_editor` 와 동일한 의미지만, 그 모듈은
`app.modules.classroom.router` 를 import 하므로 협업 자료/파일 모듈이 top-level 로
가져오면 순환 import 위험이 있다 (classroom.teachers → classroom.router → 하위
모듈 → classroom.teachers). 이 헬퍼는 **모델에만 의존**해 어느 모듈에서나 안전하게
import 가능하다 — 협업 에디터(docs/slides/sheets/hwps/surveys), files 가드 등이 공용.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course
from app.models.course_teacher import CourseTeacher
from app.models.user import User


async def is_course_teacher(db: AsyncSession, course: Course, user: User) -> bool:
    """user 가 course 의 담당 교사(owner=Course.teacher_id 또는 co_teacher)인가."""
    if course.teacher_id == user.id:
        return True
    row = (await db.execute(
        select(CourseTeacher.id).where(
            CourseTeacher.course_id == course.id,
            CourseTeacher.user_id == user.id,
        )
    )).first()
    return row is not None
