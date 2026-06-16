"""Document CRUD — list / create / get / update / delete."""

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CourseStudent
from app.models.course_teacher import CourseTeacher
from app.models.classroom_docs import ClassroomDocument, DocumentMember
from app.models.user import User
from app.modules.classroom_docs._helpers import (
    assert_active_course_or_403, assert_can_read, doc_to_dict,
    is_admin, resolve_permission,
)
from app.modules.classroom_docs.router import router
from app.modules.classroom_docs.schemas import DocumentCreate, DocumentUpdate


@router.get("")
async def list_docs(
    course_id: int | None = Query(None),
    include_archived: bool = Query(False),
    mine: bool = Query(False, description="True면 본인이 만든 문서만"),
    user: User = Depends(require_permission("classroom.doc.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 접근 가능한 문서 목록. mine=true면 본인 작성만."""
    base = select(ClassroomDocument)
    if course_id is not None:
        base = base.where(ClassroomDocument.course_id == course_id)
    if not include_archived:
        base = base.where(ClassroomDocument.is_archived.is_(False))

    if mine:
        # admin도 본인 작성만 보고 싶으면 mine=true (구글 식 "내 작업")
        q = base.where(ClassroomDocument.owner_id == user.id)
    elif is_admin(user):
        q = base
    else:
        teacher_course_ids = (await db.execute(
            select(Course.id).where(or_(
                Course.teacher_id == user.id,
                Course.id.in_(
                    select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
                ),
            ))
        )).scalars().all()
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        member_doc_ids = (await db.execute(
            select(DocumentMember.document_id).where(DocumentMember.user_id == user.id)
        )).scalars().all()

        conds = [ClassroomDocument.owner_id == user.id]
        if course_ids:
            conds.append(
                (ClassroomDocument.access_mode == "course_members") &
                (ClassroomDocument.course_id.in_(course_ids))
            )
        if member_doc_ids:
            conds.append(ClassroomDocument.id.in_(member_doc_ids))
        q = base.where(or_(*conds))

    q = q.order_by(desc(ClassroomDocument.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    owner_ids = {d.owner_id for d in rows}
    owners: dict[int, str] = {}
    if owner_ids:
        urows = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owners = {u.id: u.name for u in urows}

    return {"items": [doc_to_dict(d, owner_name=owners.get(d.owner_id)) for d in rows]}


@router.post("")
async def create_doc(
    body: DocumentCreate, request: Request,
    user: User = Depends(require_permission("classroom.doc.create")),
    db: AsyncSession = Depends(get_db),
):
    course: Course | None = None
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        # 정책: 강좌 안 문서는 강좌 교사 또는 admin만 (학생은 단독만 허용)
        if not is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌만 문서 생성 가능 (학생은 단독 문서만)")
        # Phase F: archived 강좌는 새 문서 생성 차단
        assert_active_course_or_403(course)
    else:
        # 단독 문서 (course_id=None) — 모든 인증 사용자(학생 포함) 본인 명의 생성 OK
        # access_mode는 link_public 또는 specific_users만 의미 — course_members는
        # 강좌 없으니 무효 (생성 후에도 멤버 누구도 자동 접근 안 됨, owner만)
        pass

    d = ClassroomDocument(
        course_id=body.course_id,
        owner_id=user.id,
        title=body.title,
        access_mode=body.access_mode,
    )
    db.add(d)
    await db.flush()
    await log_action(
        db, user, "classroom.doc.create",
        target=f"doc:{d.id} course:{body.course_id}", request=request,
    )
    return doc_to_dict(d, owner_name=user.name)


@router.get("/{did}")
async def get_doc(
    did: int,
    user: User = Depends(require_permission("classroom.doc.view")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    perm = await assert_can_read(db, user, d)
    owner = await db.get(User, d.owner_id)
    return {
        **doc_to_dict(d, owner_name=owner.name if owner else None),
        "permission": perm,
    }


@router.put("/{did}")
async def update_doc(
    did: int, body: DocumentUpdate, request: Request,
    user: User = Depends(require_permission("classroom.doc.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    perm = await resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")
    if body.access_mode is not None and body.access_mode != d.access_mode:
        if not perm["can_share"]:
            raise HTTPException(403, "공유 설정 변경은 소유자/관리자만")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(d, k, v)
    await db.flush()
    # onupdate=func.now()로 updated_at이 expired — async refresh 필수
    # (없으면 doc_to_dict의 .isoformat()가 sync IO 시도 → MissingGreenlet)
    await db.refresh(d)
    await log_action(db, user, "classroom.doc.update", target=f"doc:{did}", request=request)
    owner = await db.get(User, d.owner_id)
    return doc_to_dict(d, owner_name=owner.name if owner else None)


@router.delete("/{did}")
async def delete_doc(
    did: int, request: Request,
    user: User = Depends(require_permission("classroom.doc.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    if d.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "소유자 또는 관리자만 삭제 가능")
    await db.delete(d)
    await log_action(db, user, "classroom.doc.delete", target=f"doc:{did}", request=request)
    return {"ok": True}
