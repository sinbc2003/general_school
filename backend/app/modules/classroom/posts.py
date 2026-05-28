"""클래스룸 글(posts) + 댓글 + 첨부 파일.

엔드포인트 (router.py의 router 객체에 등록):
  GET    /api/classroom/courses/{cid}/posts     글 목록 (페이지네이션)
  POST   /api/classroom/courses/{cid}/posts     글 작성 (공지/자료/과제)
  GET    /api/classroom/posts/{pid}             글 상세
  PUT    /api/classroom/posts/{pid}             글 편집
  DELETE /api/classroom/posts/{pid}             글 삭제

  GET    /api/classroom/posts/{pid}/comments    댓글 목록
  POST   /api/classroom/posts/{pid}/comments    댓글 작성
  DELETE /api/classroom/posts/comments/{cid}    댓글 삭제

  POST   /api/classroom/courses/{cid}/attachments   첨부 파일 업로드

정책:
  - 과거 학기 강좌는 read-only — POST/PUT/DELETE 모두 409 차단 (admin 포함).
  - 댓글은 강좌 멤버(교사·학생·admin)만 작성.
  - 첨부는 본인 강좌 + classroom.post.write 권한자만.
"""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.core.upload import POLICY_CLASSROOM, check_extension, validate_upload
from app.models.classroom import Course, CoursePost, CoursePostComment, CourseStudent
from app.models.user import User
from app.modules.classroom.router import (
    _assert_course_access, _is_admin, _post_to_dict, router,
)
from app.modules.classroom.schemas import CoursePostCreate, CoursePostUpdate
from app.modules.classroom.teachers import is_course_editor, is_course_editor_or_admin


# ─────────────────────────────────────────────────────────────────────────────
# 글 (Posts) CRUD
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/courses/{cid}/posts")
async def list_course_posts(
    cid: int,
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """강좌 글 목록 (페이지네이션). 기본 30, 최대 100.

    학기당 글 100+ 누적 시 응답 폭증 방지. is_pinned 우선 정렬 유지.
    """
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    await _assert_course_access(db, user, c)

    rows = (await db.execute(
        select(CoursePost).where(CoursePost.course_id == cid)
        .order_by(desc(CoursePost.is_pinned), desc(CoursePost.created_at))
        .offset(offset).limit(limit)
    )).scalars().all()

    # 작성자 이름
    author_ids = {p.author_id for p in rows if p.author_id}
    authors: dict[int, str] = {}
    if author_ids:
        urows = (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all()
        authors = {u.id: u.name for u in urows}

    return {
        "limit": limit, "offset": offset,
        "items": [_post_to_dict(p, authors.get(p.author_id)) for p in rows],
    }


@router.post("/courses/{cid}/posts")
async def create_course_post(
    cid: int, body: CoursePostCreate, request: Request,
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    c = await db.get(Course, cid)
    if not c:
        raise HTTPException(404)
    if not await is_course_editor_or_admin(db, c, user):
        raise HTTPException(403, "본인 강좌만 글 작성 가능 (소유자·공동교사·관리자)")
    # 과거 학기 강좌는 read-only — admin 포함 차단
    active_sid = await get_active_semester_id_or_404(db)
    if c.semester_id != active_sid:
        raise HTTPException(409, "이전 학기 강좌입니다. 새 글은 현재 학기 강좌에 작성하세요.")

    p = CoursePost(
        course_id=cid,
        author_id=user.id,
        post_type=body.post_type,
        title=body.title,
        content=body.content,
        is_pinned=body.is_pinned,
        due_date=body.due_date,
        max_score=body.max_score,
        topic=body.topic,
        attachments=(
            [a.model_dump(exclude_none=True) for a in body.attachments]
            if body.attachments else None
        ),
    )
    db.add(p)
    await db.flush()

    # 알림: 강좌 수강생 전체에게 — best-effort (실패해도 게시는 성공)
    try:
        from app.services.notification import notify_users
        student_ids = (await db.execute(
            select(CourseStudent.student_id).where(
                CourseStudent.course_id == cid,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        type_label = {
            "notice": "공지사항",
            "material": "자료",
            "assignment_ref": "과제",
        }.get(p.post_type, "글")
        await notify_users(
            db, user_ids=list(student_ids),
            type=f"classroom.{p.post_type}.new",
            title=f"[{c.name}] 새 {type_label}: {p.title}",
            body=(p.content or "")[:300] or None,
            link_url=f"/s/classroom/{cid}/posts/{p.id}",
            source_user_id=user.id,
            meta={"course_id": cid, "post_id": p.id, "post_type": p.post_type},
        )
    except Exception as e:  # noqa: F841
        import logging
        logging.getLogger(__name__).warning("post notify failed: %s", e)

    await log_action(
        db, user, "classroom.post.create",
        target=f"course:{cid} post:{p.id}", request=request,
    )
    return _post_to_dict(p, user.name)


@router.get("/posts/{pid}")
async def get_course_post(
    pid: int,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """단일 글 상세 — 과제 상세 페이지용. 강좌 멤버만 접근 가능."""
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_course_access(db, user, course)
    author = await db.get(User, p.author_id) if p.author_id else None
    return {
        **_post_to_dict(p, author.name if author else None),
        "course_name": course.name,
        "course_subject": course.subject,
        "course_class_name": course.class_name,
    }


@router.put("/posts/{pid}")
async def update_course_post(
    pid: int, body: CoursePostUpdate, request: Request,
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    # 본인 글이거나, 강좌 editor(owner/co_teacher) 또는 admin
    course = await db.get(Course, p.course_id)
    is_author = p.author_id == user.id
    is_editor = course is not None and await is_course_editor_or_admin(db, course, user)
    if not (is_author or is_editor):
        raise HTTPException(403, "본인 글 또는 강좌 교사·관리자만 편집 가능")
    # 과거 학기 글은 read-only
    active_sid = await get_active_semester_id_or_404(db)
    if course and course.semester_id != active_sid:
        raise HTTPException(409, "이전 학기 강좌의 글은 수정할 수 없습니다 (read-only).")
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if k == "attachments" and v is not None:
            # Attachment 객체 list → dict list
            setattr(p, k, [a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else a for a in v])
        elif v is not None:
            setattr(p, k, v)
    await db.flush()
    await db.refresh(p)
    return _post_to_dict(p)


@router.delete("/posts/{pid}")
async def delete_course_post(
    pid: int, request: Request,
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    # 본인 글이거나, 강좌 editor(owner/co_teacher) 또는 admin
    course = await db.get(Course, p.course_id)
    is_author = p.author_id == user.id
    is_editor = course is not None and await is_course_editor_or_admin(db, course, user)
    if not (is_author or is_editor):
        raise HTTPException(403, "본인 글 또는 강좌 교사·관리자만 삭제 가능")
    # 과거 학기 글은 read-only — PUT과 동일 정책
    active_sid = await get_active_semester_id_or_404(db)
    if course and course.semester_id != active_sid:
        raise HTTPException(409, "이전 학기 강좌의 글은 삭제할 수 없습니다 (read-only).")
    await db.delete(p)
    await log_action(
        db, user, "classroom.post.delete",
        target=f"course_post:{pid}",
        request=request,
    )
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# 글 댓글 (수업 댓글)
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/posts/{pid}/comments")
async def list_post_comments(
    pid: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """글 댓글 목록 (시간순 — 채팅처럼). 기본 100, 최대 500."""
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_course_access(db, user, course)

    total = (await db.execute(
        select(func.count(CoursePostComment.id))
        .where(CoursePostComment.post_id == pid)
    )).scalar() or 0
    rows = (await db.execute(
        select(CoursePostComment, User.name)
        .join(User, User.id == CoursePostComment.author_id, isouter=True)
        .where(CoursePostComment.post_id == pid)
        .order_by(CoursePostComment.created_at)
        .offset(offset).limit(limit)
    )).all()
    return {
        "items": [
            {
                "id": c.id, "post_id": c.post_id, "author_id": c.author_id,
                "author_name": name, "content": c.content,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c, name in rows
        ],
        "limit": limit, "offset": offset, "total": int(total),
    }


@router.post("/posts/{pid}/comments")
async def create_post_comment(
    pid: int, request: Request,
    body: dict,  # {"content": "..."}
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """댓글 작성. 본인 강좌 접근 권한이 있는 사용자 모두 가능 (학생도)."""
    content = (body.get("content") or "").strip()
    if not content:
        raise HTTPException(400, "댓글 내용을 입력하세요")
    if len(content) > 5000:
        raise HTTPException(400, "5000자 이하")

    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404)
    await _assert_course_access(db, user, course)
    # 과거 학기 글에는 댓글 차단 (read-only)
    active_sid = await get_active_semester_id_or_404(db)
    if course.semester_id != active_sid:
        raise HTTPException(409, "이전 학기 강좌의 글에는 댓글을 달 수 없습니다.")

    c = CoursePostComment(post_id=pid, author_id=user.id, content=content)
    db.add(c)
    await db.flush()

    # 알림 — 글 작성자 + 기존 댓글 작성자들에게 (본인 제외 자동)
    try:
        from app.services.notification import notify_users
        targets: set[int] = set()
        if p.author_id:
            targets.add(p.author_id)
        # 기존 댓글 작성자들 (중복 발송 방지를 위해 set)
        prev_authors = (await db.execute(
            select(CoursePostComment.author_id).where(
                CoursePostComment.post_id == pid,
                CoursePostComment.id != c.id,
                CoursePostComment.author_id.is_not(None),
            )
        )).scalars().all()
        targets.update([uid for uid in prev_authors if uid])
        if targets:
            await notify_users(
                db, user_ids=list(targets),
                type="classroom.post.commented",
                title=f"[{course.name}] {user.name}님이 댓글을 남김",
                body=content[:300],
                # admin인지 student인지에 따라 다르지만 우선 학생 경로로 — 권한 있는 사용자만 보이게
                link_url=f"/s/classroom/{course.id}/posts/{pid}",
                source_user_id=user.id,
                meta={"course_id": course.id, "post_id": pid, "comment_id": c.id},
            )
    except Exception as e:  # noqa: F841
        import logging
        logging.getLogger(__name__).warning("comment notify failed: %s", e)

    return {
        "id": c.id, "post_id": pid, "author_id": user.id,
        "author_name": user.name, "content": c.content,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.delete("/posts/comments/{cid}")
async def delete_post_comment(
    cid: int,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """댓글 삭제 — 본인 또는 강좌 교사/admin만."""
    c = await db.get(CoursePostComment, cid)
    if not c:
        raise HTTPException(404)
    p = await db.get(CoursePost, c.post_id)
    course = await db.get(Course, p.course_id) if p else None
    is_owner = c.author_id == user.id
    is_teacher = bool(course) and await is_course_editor_or_admin(db, course, user)
    if not (is_owner or is_teacher):
        raise HTTPException(403, "본인 댓글 또는 강좌 교사·관리자만 삭제 가능")
    await db.delete(c)
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# 첨부 파일 업로드
# ─────────────────────────────────────────────────────────────────────────────


# settings.STORAGE_ROOT 기반 (Phase 2-Q 통합).
from app.core.files import DEFAULT_STORAGE_ROOT
STORAGE_ROOT = DEFAULT_STORAGE_ROOT
CLASSROOM_DIR = STORAGE_ROOT / "classroom"


@router.post("/courses/{cid}/attachments")
async def upload_attachment(
    cid: int, request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    """강좌 첨부 파일 업로드 — 검증 + storage 저장 + URL 반환.

    프론트엔드가 받은 file_url/file_name을 AssignmentModal의 attachments에
    {type:"file", file_url, file_name, title} 형태로 추가한 뒤 POST/PUT 호출.

    storage 경로: backend/storage/classroom/{uuid}{ext}
    files/router.py의 _GUARDS에 classroom section 등록 必 — 그래야 다운로드 시
    인증/권한 통과 후만 서빙.

    권한:
    - 작성 권한이 있는 교사·관리자만 (require_permission)
    - 본인 강좌 또는 admin (여기서 추가 확인)
    """
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌 없음")
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "본인 강좌만 업로드 가능 (소유자·공동교사·관리자)")

    # 검증 (크기·확장자)
    data = await validate_upload(file, POLICY_CLASSROOM)
    ext = check_extension(file.filename, POLICY_CLASSROOM)

    # 저장 — uuid 사용해 collision 방지 + 추측 차단
    # 동기 IO는 to_thread로 위임 — event loop 비차단 (50MB 업로드도 다른 요청 막지 않음)
    from app.core.files import ensure_dir_async, write_bytes_async
    await ensure_dir_async(CLASSROOM_DIR)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    full = CLASSROOM_DIR / stored_name
    await write_bytes_async(full, data)

    file_url = f"/storage/classroom/{stored_name}"
    original_name = (file.filename or stored_name).strip()

    await log_action(
        db, user, "classroom.attachment.upload",
        target=f"course:{cid} bytes:{len(data)} ext:{ext}", request=request,
    )

    return {
        "file_url": file_url,
        "file_name": original_name,
        "byte_size": len(data),
    }
