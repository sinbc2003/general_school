"""인증된 파일 서빙 — /storage 직접 노출 차단의 대체.

이전엔 main.py의 `app.mount("/storage", StaticFiles(...))`로 모든 파일이
익명 접근 가능했음. 학생 비공개 산출물·과제 제출물·백업 ZIP까지 외부 노출.

본 모듈로 인증 + 모듈별 권한 가드 통과 후만 파일 서빙.

라우팅:
  GET /api/files/storage/{path:path}
    - path traversal 차단 (.., 절대경로)
    - section(첫 segment) 기반 권한 가드 (각 모듈 ownership 검증):
      · artifacts: owner OR is_public OR admin OR teacher+visibility
      · assignments: owner submission OR review 권한 교사 OR admin
      · research: project member/advisor OR admin
      · documents: archive.document.view 권한 (인증 시 모두)
      · club: submission author OR club advisor/member OR admin
      · auto-backups: super_admin 전용
    - branding/* 은 main.py에서 별도 익명 mount → 본 라우트 안 거침

Frontend는 `<a href={/storage/...}>` 대신 fetch + blob 패턴 사용:
  lib/api/download.ts의 downloadSecure() 헬퍼.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.visibility import assert_can_view_student
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.archive import Document
from app.models.classroom import Course, CoursePost, CourseStudent
from app.models.club import Club, ClubSubmission
from app.models.research import ResearchProject, ResearchSubmission
from app.models.student_self import StudentArtifact
from app.models.user import User

router = APIRouter(prefix="/api/files", tags=["files"])

# settings.STORAGE_ROOT 기반 (Phase 2-Q 통합).
from app.core.files import DEFAULT_STORAGE_ROOT
STORAGE_DIR = DEFAULT_STORAGE_ROOT


# ── section별 가드 ─────────────────────────────────────────


async def _guard_artifact(db: AsyncSession, user: User, path: str) -> None:
    """artifacts: owner OR is_public OR admin OR teacher+visibility."""
    file_url = f"/storage/{path}"
    artifact = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.file_url == file_url)
    )).scalar_one_or_none()
    if not artifact:
        raise HTTPException(404)

    if artifact.student_id == user.id:
        return
    if user.role in ("super_admin", "designated_admin"):
        return
    if artifact.is_public:
        return
    if user.role in ("teacher", "staff"):
        await assert_can_view_student(db, user, artifact.student_id)
        return
    raise HTTPException(403, "권한 없음")


async def _guard_assignment(db: AsyncSession, user: User, path: str) -> None:
    """assignments: owner submission OR review 권한 교사 OR admin."""
    stored_path = f"storage/{path}"
    sub = (await db.execute(
        select(AssignmentSubmission).where(AssignmentSubmission.stored_path == stored_path)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(404)

    if sub.user_id == user.id:
        return  # 본인 제출물
    if user.role in ("super_admin", "designated_admin"):
        return
    if user.role in ("teacher", "staff"):
        # 교사: 학생 visibility + assignment 권한 (review 권한 가진 교사)
        # 단순화: visibility 가드 통과한 학생의 제출물이면 OK
        await assert_can_view_student(db, user, sub.user_id)
        return
    raise HTTPException(403, "권한 없음")


async def _guard_research(db: AsyncSession, user: User, path: str) -> None:
    """research: 프로젝트 advisor/member/submitter OR admin."""
    stored_path = f"storage/{path}"
    sub = (await db.execute(
        select(ResearchSubmission).where(ResearchSubmission.stored_path == stored_path)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(404)

    if sub.submitted_by_id == user.id:
        return
    if user.role in ("super_admin", "designated_admin"):
        return
    # advisor / project member
    project = (await db.execute(
        select(ResearchProject).where(ResearchProject.id == sub.project_id)
    )).scalar_one_or_none()
    if project:
        if project.advisor_id == user.id:
            return
        # members JSON list: 학생 이름 또는 user_id list. 두 가지 모두 체크.
        members = project.members or []
        if user.id in members:
            return
        if user.name in members:
            return
    raise HTTPException(403, "권한 없음")


async def _guard_archive_document(db: AsyncSession, user: User, path: str) -> None:
    """documents: archive.document.view 권한 (모든 인증 사용자 가능).

    실제로는 archive.document.view 권한이 default_roles에 부여되어 학생에게도 허용됨.
    민감 문서는 별도 권한·라벨링으로 통제 (현재 구현 안 됨).
    """
    stored_path = f"storage/{path}"
    doc = (await db.execute(
        select(Document).where(Document.stored_path == stored_path)
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(404)

    if user.role in ("super_admin", "designated_admin", "teacher", "staff"):
        return
    # 학생: archive.document.view 권한이 있어야 (default_roles로 부여됨)
    from app.core.permissions import resolve_permissions
    perms = await resolve_permissions(db, user)
    if "archive.document.view" in perms:
        return
    raise HTTPException(403, "권한 없음")


async def _guard_club(db: AsyncSession, user: User, path: str) -> None:
    """club: submission author OR club advisor/member OR admin.

    ClubSubmission.file_path 형식은 사용자가 입력. /storage/...로 시작하면 매칭.
    """
    candidates = [f"/storage/{path}", f"storage/{path}"]
    sub = None
    for cand in candidates:
        sub = (await db.execute(
            select(ClubSubmission).where(ClubSubmission.file_path == cand)
        )).scalar_one_or_none()
        if sub:
            break
    if not sub:
        raise HTTPException(404)

    if sub.author_id == user.id:
        return
    if user.role in ("super_admin", "designated_admin"):
        return
    # 동아리 advisor / member
    club = (await db.execute(
        select(Club).where(Club.id == sub.club_id)
    )).scalar_one_or_none()
    if club:
        if club.advisor_id == user.id:
            return
        members = club.members or []
        if user.id in members or user.name in members:
            return
    raise HTTPException(403, "권한 없음")


async def _guard_classroom(db: AsyncSession, user: User, path: str) -> None:
    """classroom: 강좌 멤버(교사·학생) 또는 admin만 다운로드.

    경로 종류:
      - storage/classroom/banners/{file}.jpg → Course.banner_image_url
      - storage/classroom/{uuid}.ext         → CoursePost.attachments / file_url

    DB lookup으로 매칭되는 row가 있어야 통과 (path 추측 차단).
    """
    file_url = f"/storage/{path}"

    # Banner 이미지: Course.banner_image_url 매칭
    if path.startswith("classroom/banners/"):
        from app.models import CourseTeacher
        course = (await db.execute(
            select(Course).where(Course.banner_image_url == file_url)
        )).scalar_one_or_none()
        if not course:
            raise HTTPException(404)
        if user.role in ("super_admin", "designated_admin"):
            return
        # viewable_by=all_teachers + 사용자가 교사/직원 → 허용
        if course.viewable_by == "all_teachers" and user.role in ("teacher", "staff", "designated_admin"):
            return
        # owner / co_teacher / active 수강생 → 허용
        if course.teacher_id == user.id:
            return
        ct = (await db.execute(
            select(CourseTeacher).where(
                CourseTeacher.course_id == course.id,
                CourseTeacher.user_id == user.id,
            )
        )).scalar_one_or_none()
        if ct:
            return
        cs = (await db.execute(
            select(CourseStudent).where(
                CourseStudent.course_id == course.id,
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalar_one_or_none()
        if cs:
            return
        raise HTTPException(403, "권한 없음")

    # CoursePost.attachments(JSON list)에 file_url이 포함된 글이 있는지 OR file_url 컬럼 직접 매칭
    # JSON에서 file_url 검색은 DB 종속이라 단순화: 모든 post의 attachments를 in-app로 검사.
    # 첨부가 많지 않다는 가정. 향후 성능 이슈 시 jsonb 인덱스 추가.
    candidate_posts = (await db.execute(
        select(CoursePost).where(
            (CoursePost.file_url == file_url)
            | CoursePost.attachments.is_not(None)
        )
    )).scalars().all()

    matched_post: CoursePost | None = None
    for p in candidate_posts:
        if p.file_url == file_url:
            matched_post = p
            break
        for a in (p.attachments or []):
            if isinstance(a, dict) and a.get("file_url") == file_url:
                matched_post = p
                break
        if matched_post:
            break

    if not matched_post:
        raise HTTPException(404)

    if user.role in ("super_admin", "designated_admin"):
        return
    # 강좌 멤버: 교사 본인 또는 active 수강생
    course = await db.get(Course, matched_post.course_id)
    if not course:
        raise HTTPException(404)
    if course.teacher_id == user.id:
        return
    from app.models import CourseTeacher
    ct = (await db.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == course.id,
            CourseTeacher.user_id == user.id,
        )
    )).scalar_one_or_none()
    if ct:
        return
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if cs:
        return
    raise HTTPException(403, "권한 없음")


async def _guard_auto_backups(db: AsyncSession, user: User, path: str) -> None:
    """auto-backups: super_admin 전용. 직접 다운로드는 별도 endpoint 권장하나
    file_url 추측 차단을 위해 가드.
    """
    if user.role != "super_admin":
        raise HTTPException(403, "최고관리자 전용")


# ── dispatcher ────────────────────────────────────────────


async def _guard_courseware(db: AsyncSession, user: User, path: str) -> None:
    """storage/courseware/{token}.{ext} — 문제은행 ZIP import 이미지.

    문제 본문 자체가 강좌 안 공개 자료라 별도 ProblemSet ownership 검증 안 함:
      - 인증된 모든 사용자가 접근 가능 (학생 풀이 시 이미지 필요)
      - path는 ZIP 풀 때 nanoid 16자(base62)로 저장 → 추측 사실상 불가
      - path traversal은 공통 가드(serve_storage)가 차단
    """
    return  # 인증만 통과하면 OK


async def _guard_hwps(db: AsyncSession, user: User, path: str) -> None:
    """storage/hwps/{hid}/<file> — ClassroomHwp.file_path 매칭 후 권한 검증."""
    from app.models.classroom_hwp import ClassroomHwp
    from app.modules.classroom_hwps.router import _resolve_permission
    full_rel = f"hwps/{path}"
    h = (await db.execute(
        select(ClassroomHwp).where(ClassroomHwp.file_path == full_rel)
    )).scalar_one_or_none()
    if not h:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, h)
    if not perm["can_read"]:
        raise HTTPException(403)


async def _guard_past_research(db: AsyncSession, user: User, path: str) -> None:
    """storage/past_research/{uuid}.pdf — 승인된 보고서는 모든 인증 사용자 view,
    pending/rejected는 본인(submitter) + supervisor + admin만.

    DB row 매칭 안 되면 404 (path 추측 차단).
    """
    from app.models.past_research import PastResearch
    from app.core.permissions import resolve_permissions

    stored_path = f"storage/{path}"
    row = (await db.execute(
        select(PastResearch).where(PastResearch.stored_path == stored_path)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)

    if user.role in ("super_admin", "designated_admin"):
        return

    if row.status != "approved":
        # 미승인 자료는 본인 또는 담당교사만
        if row.submitted_by_student_id == user.id:
            return
        if row.supervisor_id == user.id:
            return
        raise HTTPException(403, "미승인 보고서")

    perms = await resolve_permissions(db, user)
    if "past_research.view" in perms:
        return
    raise HTTPException(403, "권한 없음")


async def _guard_group_submission(db: AsyncSession, user: User, path: str) -> None:
    """storage/group_submissions/{uuid}.ext — 학생 그룹 산출물.

    접근: 학생 본인 OR 그룹 owner/멤버 OR admin.
    """
    from app.models.teacher_group import (
        GroupSubmission, TeacherGroup, TeacherGroupMember,
    )

    file_url = f"/storage/{path}"
    sub = (await db.execute(
        select(GroupSubmission).where(GroupSubmission.file_url == file_url)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(404)

    if user.role in ("super_admin", "designated_admin"):
        return
    if sub.student_id == user.id:
        return

    g = await db.get(TeacherGroup, sub.group_id)
    if g and g.owner_id == user.id:
        return
    membership = (await db.execute(
        select(TeacherGroupMember).where(
            TeacherGroupMember.group_id == sub.group_id,
            TeacherGroupMember.teacher_id == user.id,
        )
    )).scalar_one_or_none()
    if membership:
        return
    raise HTTPException(403, "권한 없음")


_GUARDS = {
    "artifacts": _guard_artifact,
    "assignments": _guard_assignment,
    "research": _guard_research,
    "documents": _guard_archive_document,
    "club": _guard_club,
    "classroom": _guard_classroom,
    "auto-backups": _guard_auto_backups,
    "hwps": _guard_hwps,
    "courseware": _guard_courseware,
    "past_research": _guard_past_research,
    "group_submissions": _guard_group_submission,
}


@router.get("/storage/{path:path}")
async def serve_storage(
    path: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """인증된 사용자에게 storage 파일 서빙 + section별 가드."""
    # path traversal 방어
    if ".." in path or path.startswith("/") or "\\" in path:
        raise HTTPException(400, "유효하지 않은 경로")

    full = (STORAGE_DIR / path).resolve()
    storage_resolved = STORAGE_DIR.resolve()
    try:
        full.relative_to(storage_resolved)
    except ValueError:
        raise HTTPException(400, "경로 위반")

    if not full.exists() or not full.is_file():
        raise HTTPException(404, "파일 없음")

    # section별 권한 가드
    parts = path.split("/", 1)
    section = parts[0] if parts else ""

    if section == "branding":
        # branding은 main.py에서 별도 익명 mount. 여기 와도 인증만 강제.
        pass
    elif section in _GUARDS:
        await _GUARDS[section](db, user, path)
    else:
        # 알 수 없는 section → 차단 (새 storage 디렉토리 만들었는데 가드 안 만들면 차단됨)
        raise HTTPException(403, f"알 수 없는 storage section: {section}")

    return FileResponse(str(full))
