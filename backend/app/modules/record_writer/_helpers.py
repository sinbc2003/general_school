"""record_writer 공통 — 프로젝트 가드, 직렬화, 범위→학생 매핑.

범위(scope)별 담당 학생 결정의 SSOT. 각 scope는 소유 검증을 포함한다
(본인 담당 강좌/담임/동아리/그룹/연구가 아니면 403).
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.classroom import Course, CourseStudent
from app.models.club import Club
from app.models.research_supervision import ResearchSupervision
from app.models.student_record_project import (
    RecordCell,
    RecordColumn,
    RecordProject,
)
from app.models.teacher_group import TeacherGroup, TeacherGroupMember, TeacherGroupStudent
from app.models.timetable import SemesterEnrollment
from app.models.user import User

VALID_SCOPES = {"course", "homeroom", "club", "group", "research", "manual"}


from app.core.permissions import is_admin  # SSOT (re-export)


async def get_owned_project(db: AsyncSession, user: User, pid: int) -> RecordProject:
    """프로젝트 조회 + 소유/admin 가드 (soft delete 제외)."""
    p = (
        await db.execute(
            select(RecordProject).where(
                RecordProject.id == pid, RecordProject.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "생활기록부 프로젝트를 찾을 수 없습니다")
    if not (is_admin(user) or p.owner_id == user.id):
        raise HTTPException(403, "본인 생활기록부 프로젝트만 접근할 수 있습니다")
    return p


def project_to_dict(p: RecordProject) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "scope_type": p.scope_type,
        "scope_ref_id": p.scope_ref_id,
        "scope_ref_class": p.scope_ref_class,
        "semester_id": p.semester_id,
        "global_prompt": p.global_prompt,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def column_to_dict(c: RecordColumn) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "display_order": c.display_order,
        "system_prompt": c.system_prompt,
        "source_config": c.source_config,
        "char_min": c.char_min,
        "char_max": c.char_max,
        "kind": c.kind,
    }


def cell_to_dict(c: RecordCell) -> dict:
    return {
        "id": c.id,
        "column_id": c.column_id,
        "student_id": c.student_id,
        "raw_data": c.raw_data,
        "raw_sources": c.raw_sources,
        "generated_text": c.generated_text,
        "status": c.status,
        "similarity_flag": c.similarity_flag,
    }


def members_user_ids(members) -> set[int]:
    """Club.members(JSON) → user_id 집합. 정규형 [{"user_id": id}] + 호환."""
    ids: set[int] = set()
    for m in members or []:
        if isinstance(m, dict):
            v = m.get("user_id") or m.get("student_id") or m.get("id")
            if v is not None:
                try:
                    ids.add(int(v))
                except (TypeError, ValueError):
                    pass
        elif isinstance(m, int):
            ids.add(m)
    return ids


async def resolve_scope_students(
    db: AsyncSession,
    user: User,
    *,
    scope_type: str,
    scope_ref_id: int | None,
    scope_ref_class: str | None,
    semester_id: int,
) -> list[int]:
    """범위에 해당하는 학생 user_id 리스트. 소유 검증 포함(실패 시 403)."""
    if scope_type not in VALID_SCOPES:
        raise HTTPException(400, f"알 수 없는 범위 유형: {scope_type}")

    admin = is_admin(user)

    if scope_type == "manual":
        return []

    if scope_type == "course":
        if not scope_ref_id:
            raise HTTPException(400, "강좌를 선택하세요")
        course = (
            await db.execute(select(Course).where(Course.id == scope_ref_id))
        ).scalar_one_or_none()
        if not course:
            raise HTTPException(404, "강좌를 찾을 수 없습니다")
        if not admin:
            from app.modules.classroom.teachers import is_course_editor

            if not await is_course_editor(db, course, user):
                raise HTTPException(403, "본인 담당 강좌만 선택할 수 있습니다")
        rows = (
            await db.execute(
                select(CourseStudent.student_id).where(
                    CourseStudent.course_id == scope_ref_id,
                    CourseStudent.status == "active",
                )
            )
        ).scalars().all()
        return list(dict.fromkeys(rows))

    if scope_type == "homeroom":
        if not scope_ref_class:
            raise HTTPException(400, "담임 학급을 선택하세요")
        if not admin:
            mine = (
                await db.execute(
                    select(SemesterEnrollment).where(
                        SemesterEnrollment.semester_id == semester_id,
                        SemesterEnrollment.user_id == user.id,
                    )
                )
            ).scalar_one_or_none()
            allowed = set()
            if mine:
                for v in (mine.homeroom_class, mine.subhomeroom_class):
                    if v:
                        allowed.add(v.strip())
            if scope_ref_class not in allowed:
                raise HTTPException(403, "본인 담임/부담임 학급만 선택할 수 있습니다")
        try:
            g_str, c_str = scope_ref_class.split("-", 1)
            g, c = int(g_str), int(c_str)
        except (ValueError, IndexError):
            raise HTTPException(400, "학급 형식이 올바르지 않습니다 (예: 3-2)")
        rows = (
            await db.execute(
                select(SemesterEnrollment.user_id).where(
                    SemesterEnrollment.semester_id == semester_id,
                    SemesterEnrollment.role == "student",
                    SemesterEnrollment.status == "active",
                    SemesterEnrollment.grade == g,
                    SemesterEnrollment.class_number == c,
                )
            )
        ).scalars().all()
        return list(dict.fromkeys(rows))

    if scope_type == "club":
        if not scope_ref_id:
            raise HTTPException(400, "동아리를 선택하세요")
        club = (
            await db.execute(select(Club).where(Club.id == scope_ref_id))
        ).scalar_one_or_none()
        if not club:
            raise HTTPException(404, "동아리를 찾을 수 없습니다")
        if not admin and club.advisor_id != user.id:
            raise HTTPException(403, "본인이 지도하는 동아리만 선택할 수 있습니다")
        return sorted(members_user_ids(club.members))

    if scope_type == "group":
        if not scope_ref_id:
            raise HTTPException(400, "그룹을 선택하세요")
        group = (
            await db.execute(select(TeacherGroup).where(TeacherGroup.id == scope_ref_id))
        ).scalar_one_or_none()
        if not group:
            raise HTTPException(404, "그룹을 찾을 수 없습니다")
        owner = group.owner_id == user.id
        if not admin and not owner:
            is_member = (
                await db.execute(
                    select(TeacherGroupMember).where(
                        TeacherGroupMember.group_id == scope_ref_id,
                        TeacherGroupMember.teacher_id == user.id,
                    )
                )
            ).scalar_one_or_none()
            if not is_member:
                raise HTTPException(403, "본인이 속한 그룹만 선택할 수 있습니다")
        stmt = select(TeacherGroupStudent.student_id).where(
            TeacherGroupStudent.group_id == scope_ref_id
        )
        # owner/admin은 그룹 전체, 참여 교사는 본인 배정 학생만
        if not admin and not owner:
            stmt = stmt.where(TeacherGroupStudent.assigned_teacher_id == user.id)
        rows = (await db.execute(stmt)).scalars().all()
        return list(dict.fromkeys(rows))

    if scope_type == "research":
        # 본인이 담당교사(supervisor)인 학생 전체 (scope_ref 불필요)
        rows = (
            await db.execute(
                select(ResearchSupervision.student_id).where(
                    ResearchSupervision.semester_id == semester_id,
                    ResearchSupervision.supervisor_id == user.id,
                )
            )
        ).scalars().all()
        return list(dict.fromkeys(rows))

    raise HTTPException(400, f"알 수 없는 범위 유형: {scope_type}")
