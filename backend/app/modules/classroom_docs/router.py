"""클래스룸 협업 문서 라우터.

경로:
  GET    /api/classroom/docs                  본인 관련 문서 목록 (filter: course_id, archived)
  POST   /api/classroom/docs                  새 문서 생성 (owner=user)
  GET    /api/classroom/docs/{did}            문서 메타 + 권한 정보 + Yjs state(옵션)
  PUT    /api/classroom/docs/{did}            메타 편집 (title/access_mode/archived)
  DELETE /api/classroom/docs/{did}            삭제 (소유자/admin)

  GET    /api/classroom/docs/{did}/members    멤버 목록 (specific_users 모드)
  POST   /api/classroom/docs/{did}/members    멤버 추가
  DELETE /api/classroom/docs/{did}/members/{uid}

  GET    /api/classroom/docs/{did}/permission   현재 사용자 권한 ({can_read, can_write, ...})
                                                Hocuspocus가 auth 체크 시 호출.
  GET    /api/classroom/docs/{did}/yjs-snapshot   현재 Yjs state (base64).
                                                  Hocuspocus가 문서 초기 로딩 시 호출.
  POST   /api/classroom/docs/{did}/yjs-snapshot   Yjs state 저장 (Hocuspocus 전용 — INTERNAL_TOKEN 인증).
                                                  Document.yjs_state 갱신 + DocumentRevision 추가.

권한 정책:
  - 소유자(owner_id) : 항상 read+write
  - 관리자(super_admin, designated_admin) : 항상 read+write
  - access_mode='course_members' : Course.teacher_id == user OR CourseStudent에 active로 등록
  - access_mode='specific_users' : DocumentMember에 등록 (role=editor면 write, viewer면 read only)
  - access_mode='link_public' : 인증 사용자 read only (편집은 owner+admin만)
"""

import base64

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.classroom import Course, CourseStudent
from app.models.classroom_docs import (
    ClassroomDocument, DocumentMember, DocumentRevision,
)
from app.models.user import User
from app.modules.classroom_docs.schemas import (
    DocumentCreate, DocumentMemberAdd, DocumentSnapshotIn, DocumentUpdate,
)

router = APIRouter(prefix="/api/classroom/docs", tags=["classroom-docs"])


# ── helpers ────────────────────────────────────────────────


def _is_admin(user: User) -> bool:
    return user.role in ("super_admin", "designated_admin")


def _doc_to_dict(d: ClassroomDocument, *, owner_name: str | None = None) -> dict:
    return {
        "id": d.id,
        "course_id": d.course_id,
        "owner_id": d.owner_id,
        "owner_name": owner_name,
        "title": d.title,
        "access_mode": d.access_mode,
        "is_archived": d.is_archived,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


async def _resolve_permission(
    db: AsyncSession, user: User, doc: ClassroomDocument,
) -> dict:
    """현재 사용자의 문서 권한을 결정.

    returns: {can_read: bool, can_write: bool, can_share: bool, role: 'owner'|'admin'|'editor'|'viewer'|None}
    """
    if doc.owner_id == user.id:
        return {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}
    if _is_admin(user):
        return {"can_read": True, "can_write": True, "can_share": True, "role": "admin"}

    if doc.access_mode == "course_members" and doc.course_id is not None:
        course = await db.get(Course, doc.course_id)
        if course:
            if course.teacher_id == user.id:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
            cs = (await db.execute(
                select(CourseStudent).where(
                    CourseStudent.course_id == doc.course_id,
                    CourseStudent.student_id == user.id,
                    CourseStudent.status == "active",
                )
            )).scalar_one_or_none()
            if cs:
                # 학생도 협업 문서 편집 (Google Docs 식)
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}

    if doc.access_mode == "specific_users":
        member = (await db.execute(
            select(DocumentMember).where(
                DocumentMember.document_id == doc.id,
                DocumentMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if member:
            return {
                "can_read": True,
                "can_write": member.role == "editor",
                "can_share": False,
                "role": member.role,
            }

    if doc.access_mode == "link_public":
        # 인증된 사용자라면 read 가능 (외부 익명은 본 라우터 가드에서 차단됨)
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


async def _assert_can_read(db: AsyncSession, user: User, doc: ClassroomDocument) -> dict:
    perm = await _resolve_permission(db, user, doc)
    if not perm["can_read"]:
        raise HTTPException(403, "문서 열람 권한이 없습니다")
    return perm


# ── CRUD ──────────────────────────────────────────────────


@router.get("")
async def list_docs(
    course_id: int | None = Query(None, description="강좌 ID 필터. null=전체."),
    include_archived: bool = Query(False),
    user: User = Depends(require_permission("classroom.doc.view")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 접근 가능한 문서 목록.

    - 소유자 OR specific_users 멤버 OR course_members(자신이 강좌 교사 또는 수강 학생).
    - 관리자는 전체.
    """
    base = select(ClassroomDocument)
    if course_id is not None:
        base = base.where(ClassroomDocument.course_id == course_id)
    if not include_archived:
        base = base.where(ClassroomDocument.is_archived.is_(False))

    if _is_admin(user):
        q = base
    else:
        # 강좌 교사로 등록된 course_id list
        teacher_course_ids = (await db.execute(
            select(Course.id).where(Course.teacher_id == user.id)
        )).scalars().all()
        # 학생으로 active 등록된 course_id list
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        # specific_users 멤버로 등록된 doc_id list
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

    # 작성자 이름 일괄 조회
    owner_ids = {d.owner_id for d in rows}
    owners: dict[int, str] = {}
    if owner_ids:
        urows = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owners = {u.id: u.name for u in urows}

    return {"items": [_doc_to_dict(d, owner_name=owners.get(d.owner_id)) for d in rows]}


@router.post("")
async def create_doc(
    body: DocumentCreate, request: Request,
    user: User = Depends(require_permission("classroom.doc.create")),
    db: AsyncSession = Depends(get_db),
):
    # 강좌 소속 문서면 강좌 접근 권한 확인 (교사·관리자만 생성 가능)
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not _is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌만 문서 생성 가능")

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
    return _doc_to_dict(d, owner_name=user.name)


@router.get("/{did}")
async def get_doc(
    did: int,
    user: User = Depends(require_permission("classroom.doc.view")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    perm = await _assert_can_read(db, user, d)
    owner = await db.get(User, d.owner_id)
    return {
        **_doc_to_dict(d, owner_name=owner.name if owner else None),
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
    perm = await _resolve_permission(db, user, d)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")
    # access_mode 변경은 share 권한 필요
    if body.access_mode is not None and body.access_mode != d.access_mode:
        if not perm["can_share"]:
            raise HTTPException(403, "공유 설정 변경은 소유자/관리자만")

    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(d, k, v)
    await db.flush()
    await log_action(db, user, "classroom.doc.update", target=f"doc:{did}", request=request)
    owner = await db.get(User, d.owner_id)
    return _doc_to_dict(d, owner_name=owner.name if owner else None)


@router.delete("/{did}")
async def delete_doc(
    did: int, request: Request,
    user: User = Depends(require_permission("classroom.doc.edit")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    # 삭제는 소유자 또는 관리자만 (다른 사람 문서 못 지움)
    if d.owner_id != user.id and not _is_admin(user):
        raise HTTPException(403, "소유자 또는 관리자만 삭제 가능")
    await db.delete(d)
    await log_action(db, user, "classroom.doc.delete", target=f"doc:{did}", request=request)
    return {"ok": True}


# ── 멤버 관리 ─────────────────────────────────────────────


@router.get("/{did}/members")
async def list_members(
    did: int,
    user: User = Depends(require_permission("classroom.doc.view")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    await _assert_can_read(db, user, d)
    rows = (await db.execute(
        select(DocumentMember, User)
        .join(User, User.id == DocumentMember.user_id)
        .where(DocumentMember.document_id == did)
        .order_by(User.name)
    )).all()
    return {
        "items": [
            {
                "id": m.id,
                "user_id": u.id,
                "user_name": u.name,
                "role": m.role,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m, u in rows
        ]
    }


@router.post("/{did}/members")
async def add_member(
    did: int, body: DocumentMemberAdd, request: Request,
    user: User = Depends(require_permission("classroom.doc.share")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, d)
    if not perm["can_share"]:
        raise HTTPException(403, "공유 권한 없음 (소유자 또는 관리자)")

    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(404, "사용자 없음")

    # 중복 체크
    dup = (await db.execute(
        select(DocumentMember).where(
            DocumentMember.document_id == did,
            DocumentMember.user_id == body.user_id,
        )
    )).scalar_one_or_none()
    if dup:
        dup.role = body.role
        await db.flush()
        return {"ok": True, "updated": True}

    m = DocumentMember(document_id=did, user_id=body.user_id, role=body.role)
    db.add(m)
    await db.flush()
    await log_action(
        db, user, "classroom.doc.member_add",
        target=f"doc:{did} user:{body.user_id} role:{body.role}", request=request,
    )
    return {"ok": True, "id": m.id}


@router.delete("/{did}/members/{uid}")
async def remove_member(
    did: int, uid: int, request: Request,
    user: User = Depends(require_permission("classroom.doc.share")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, d)
    if not perm["can_share"]:
        raise HTTPException(403, "공유 권한 없음")
    m = (await db.execute(
        select(DocumentMember).where(
            DocumentMember.document_id == did,
            DocumentMember.user_id == uid,
        )
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await log_action(
        db, user, "classroom.doc.member_remove",
        target=f"doc:{did} user:{uid}", request=request,
    )
    return {"ok": True}


# ── Hocuspocus 연동 ───────────────────────────────────────


@router.get("/{did}/permission")
async def check_doc_permission(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 서버가 WS 연결 시 호출. 현재 사용자의 문서 권한 반환."""
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    if d.is_archived:
        # 보관된 문서는 read only 강제
        perm = await _resolve_permission(db, user, d)
        perm["can_write"] = False
        return perm
    return await _resolve_permission(db, user, d)


@router.get("/{did}/yjs-snapshot")
async def get_yjs_snapshot(
    did: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus가 문서 초기 로딩 시 호출. 마지막 저장된 Yjs state(base64) 반환."""
    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)
    await _assert_can_read(db, user, d)

    if d.yjs_state is None:
        return {"state_base64": None, "doc_id": did}
    return {
        "state_base64": base64.b64encode(d.yjs_state).decode("ascii"),
        "doc_id": did,
    }


@router.post("/{did}/yjs-snapshot")
async def save_yjs_snapshot(
    did: int, body: DocumentSnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 전용 endpoint. INTERNAL_TOKEN으로 인증 (사용자 JWT 안 씀).

    1분 debounce로 호출 → Document.yjs_state 갱신 + DocumentRevision insert.
    """
    expected_token = settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected_token:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정 (서버 환경변수 확인)")
    if x_internal_token != expected_token:
        raise HTTPException(401, "내부 토큰 인증 실패")

    d = await db.get(ClassroomDocument, did)
    if not d:
        raise HTTPException(404)

    try:
        state = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "state_base64 디코딩 실패")

    d.yjs_state = state
    if body.plain_text is not None:
        d.plain_text = body.plain_text

    # revision 누적 (롤백·감사). 너무 자주는 X → Hocuspocus debounce에 위임.
    rev = DocumentRevision(
        document_id=did,
        yjs_state=state,
        plain_text=body.plain_text,
        created_by_id=body.created_by_id,
    )
    db.add(rev)
    await db.flush()
    return {"ok": True, "revision_id": rev.id, "byte_size": len(state)}
