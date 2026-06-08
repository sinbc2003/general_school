"""생기부 프로젝트 범위 선택 옵션 — 본인이 만들 수 있는 강좌/담임/동아리/그룹/연구.

프로젝트 생성 모달에서 이 옵션으로 드롭다운을 구성한다. 본인 담당만 반환되므로
범위 선택 자체가 권한 가드 역할(resolve_scope_students가 한 번 더 검증).
"""

from fastapi import Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.models.classroom import Course
from app.models.club import Club
from app.models.course_teacher import CourseTeacher
from app.models.research_supervision import ResearchSupervision
from app.models.teacher_group import TeacherGroup, TeacherGroupMember
from app.models.timetable import SemesterEnrollment
from app.models.user import User
from app.modules.record_writer._helpers import is_admin
from app.modules.record_writer.router import router


@router.get("/scope-options")
async def scope_options(
    user: User = Depends(require_permission("record.project.view")),
    db: AsyncSession = Depends(get_db),
):
    semester_id = await get_active_semester_id_or_404(db)
    admin = is_admin(user)
    out: dict = {
        "courses": [],
        "homerooms": [],
        "clubs": [],
        "groups": [],
        "research_count": 0,
    }

    # ── 강좌 (owner + co_teacher) ──
    course_filter = [Course.semester_id == semester_id]
    if admin:
        courses = (await db.execute(select(Course).where(*course_filter))).scalars().all()
    else:
        owned = (
            await db.execute(
                select(Course).where(Course.semester_id == semester_id, Course.teacher_id == user.id)
            )
        ).scalars().all()
        co_ids = (
            await db.execute(
                select(CourseTeacher.course_id).where(CourseTeacher.teacher_id == user.id)
            )
        ).scalars().all()
        co_courses = []
        if co_ids:
            co_courses = (
                await db.execute(
                    select(Course).where(
                        Course.id.in_(co_ids), Course.semester_id == semester_id
                    )
                )
            ).scalars().all()
        courses = list(owned) + list(co_courses)
    seen: set[int] = set()
    for c in courses:
        if c.id in seen:
            continue
        seen.add(c.id)
        cls = getattr(c, "class_name", None) or ""
        out["courses"].append({"id": c.id, "label": f"{c.subject} {cls}".strip()})

    # ── 담임/부담임 학급 ──
    mine = (
        await db.execute(
            select(SemesterEnrollment).where(
                SemesterEnrollment.semester_id == semester_id,
                SemesterEnrollment.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if mine:
        for v in (mine.homeroom_class, mine.subhomeroom_class):
            if v and v.strip():
                out["homerooms"].append(v.strip())

    # ── 동아리 (advisor) ──
    club_q = select(Club).where(Club.semester_id == semester_id)
    if not admin:
        club_q = club_q.where(Club.advisor_id == user.id)
    clubs = (await db.execute(club_q)).scalars().all()
    out["clubs"] = [{"id": c.id, "label": c.name} for c in clubs]

    # ── 그룹 (owner + member) ──
    if admin:
        groups = (
            await db.execute(
                select(TeacherGroup).where(TeacherGroup.semester_id == semester_id)
            )
        ).scalars().all()
    else:
        owned_g = (
            await db.execute(
                select(TeacherGroup).where(
                    TeacherGroup.semester_id == semester_id,
                    TeacherGroup.owner_id == user.id,
                )
            )
        ).scalars().all()
        member_gids = (
            await db.execute(
                select(TeacherGroupMember.group_id).where(
                    TeacherGroupMember.teacher_id == user.id
                )
            )
        ).scalars().all()
        member_groups = []
        if member_gids:
            member_groups = (
                await db.execute(
                    select(TeacherGroup).where(
                        TeacherGroup.id.in_(member_gids),
                        TeacherGroup.semester_id == semester_id,
                    )
                )
            ).scalars().all()
        groups = list(owned_g) + list(member_groups)
    gseen: set[int] = set()
    for g in groups:
        if g.id in gseen:
            continue
        gseen.add(g.id)
        out["groups"].append({"id": g.id, "label": g.name})

    # ── 연구 담당 학생 수 ──
    research_q = select(func.count(ResearchSupervision.id)).where(
        ResearchSupervision.semester_id == semester_id
    )
    if not admin:
        research_q = research_q.where(ResearchSupervision.supervisor_id == user.id)
    out["research_count"] = (await db.execute(research_q)).scalar() or 0

    return out
