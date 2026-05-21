"""공동교사 관리 — owner + co_teacher 운영.

권한 모델:
  - owner = Course.teacher_id (생성자, 강좌 삭제·소유권 이관 가능)
  - co_teacher = CourseTeacher 테이블 (글 작성/채점/멤버 관리 가능, 강좌 삭제 불가)

이 모듈의 헬퍼는 모든 강좌 권한 가드의 단일 진실 공급원(SSOT):
  is_course_editor(course, user)        — owner OR co_teacher (편집 권한)
  is_course_editor_or_admin(course, u)  — 위 + admin
  load_course_teachers(db, course_id)   — owner + co_teachers 정보 일괄 조회

엔드포인트:
  GET    /api/classroom/courses/{cid}/teachers      — 교사 목록
  POST   /api/classroom/courses/{cid}/teachers      — co_teacher 추가 (owner만)
  DELETE /api/classroom/courses/{cid}/teachers/{uid} — co_teacher 제거 (owner만)
"""

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import Course, CourseTeacher, User
from app.modules.classroom.router import router


# ─────────────────────────────────────────────────────────────────────────────
# 공통 헬퍼 (다른 모듈에서 import)
# ─────────────────────────────────────────────────────────────────────────────


async def get_coteacher_ids(db: AsyncSession, course_id: int) -> set[int]:
    rows = (await db.execute(
        select(CourseTeacher.user_id).where(CourseTeacher.course_id == course_id)
    )).scalars().all()
    return set(rows)


async def is_course_editor(db: AsyncSession, course: Course, user: User) -> bool:
    """owner or co_teacher 여부."""
    if course.teacher_id == user.id:
        return True
    co_ids = await get_coteacher_ids(db, course.id)
    return user.id in co_ids


async def is_course_editor_or_admin(db: AsyncSession, course: Course, user: User) -> bool:
    if user.role in ("super_admin", "designated_admin"):
        return True
    return await is_course_editor(db, course, user)


# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────


class AddCoTeacher(BaseModel):
    user_id: int = Field(..., gt=0)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/courses/{cid}/teachers")
async def list_course_teachers(
    cid: int,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")

    # owner
    owner = await db.get(User, course.teacher_id)
    items = []
    if owner:
        items.append({
            "user_id": owner.id, "name": owner.name, "email": owner.email,
            "role": "owner",
        })
    # co_teachers
    rows = (await db.execute(
        select(CourseTeacher, User).join(User, CourseTeacher.user_id == User.id)
        .where(CourseTeacher.course_id == cid).order_by(CourseTeacher.added_at)
    )).all()
    for ct, u in rows:
        items.append({
            "user_id": u.id, "name": u.name, "email": u.email,
            "role": ct.role, "added_at": ct.added_at.isoformat() if ct.added_at else None,
        })
    return {"items": items}


@router.post("/courses/{cid}/teachers")
async def add_co_teacher(
    cid: int,
    body: AddCoTeacher,
    request: Request,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """공동교사 추가. owner 또는 admin만 가능."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")
    if not (user.role in ("super_admin", "designated_admin") or course.teacher_id == user.id):
        raise HTTPException(403, "소유자(owner) 또는 관리자만 공동교사를 추가할 수 있습니다")

    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(404, "대상 사용자를 찾을 수 없습니다")
    if target.role not in ("teacher", "staff", "designated_admin", "super_admin"):
        raise HTTPException(400, "공동교사는 교사/직원/관리자만 가능합니다")
    if target.id == course.teacher_id:
        raise HTTPException(409, "이미 소유자입니다")

    dup = (await db.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == cid, CourseTeacher.user_id == target.id,
        )
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "이미 공동교사로 등록되어 있습니다")

    ct = CourseTeacher(
        course_id=cid, user_id=target.id, role="co_teacher", added_by=user.id,
    )
    db.add(ct)
    await db.flush()

    # 자동 폴더 동기화 (best-effort).
    try:
        from app.services.folder_seed import on_course_teacher_assigned
        await on_course_teacher_assigned(db, course_id=cid, user_id=target.id)
    except Exception:
        pass

    await log_action(
        db, user, "course_coteacher_add",
        target=f"course:{cid}",
        detail=f"user={target.email}", request=request,
    )
    return {"ok": True, "user_id": target.id, "name": target.name, "email": target.email, "role": "co_teacher"}


@router.delete("/courses/{cid}/teachers/{uid}")
async def remove_co_teacher(
    cid: int,
    uid: int,
    request: Request,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """공동교사 제거. owner 또는 admin만 가능."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")
    if not (user.role in ("super_admin", "designated_admin") or course.teacher_id == user.id):
        raise HTTPException(403, "소유자(owner) 또는 관리자만 공동교사를 제거할 수 있습니다")
    if uid == course.teacher_id:
        raise HTTPException(400, "소유자는 제거할 수 없습니다 (소유권 이관 필요)")

    ct = (await db.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == cid, CourseTeacher.user_id == uid,
        )
    )).scalar_one_or_none()
    if not ct:
        raise HTTPException(404, "해당 공동교사가 없습니다")

    await db.delete(ct)
    await db.flush()
    await log_action(
        db, user, "course_coteacher_remove",
        target=f"course:{cid}", detail=f"user_id={uid}", request=request,
    )
    return {"ok": True}
