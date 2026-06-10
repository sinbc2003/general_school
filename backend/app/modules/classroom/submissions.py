"""클래스룸 과제 제출 — Google Classroom '내 과제' (Turn in / Unsubmit / Return).

엔드포인트 (router.py의 router 객체에 등록):
  학생 (active 수강생):
    GET  /api/classroom/posts/{pid}/my-submission          본인 제출 상태 + 사본
    PUT  /api/classroom/posts/{pid}/my-submission          첨부 목록 교체
    POST /api/classroom/posts/{pid}/my-submission/files    제출용 파일 업로드
    POST /api/classroom/posts/{pid}/my-submission/turn-in  제출
    POST /api/classroom/posts/{pid}/my-submission/unsubmit 제출 취소

  교사 (owner/co_teacher/admin):
    GET  /api/classroom/posts/{pid}/submissions                       학생별 현황
    POST /api/classroom/posts/{pid}/submissions/{student_id}/return   점수·피드백 반환

정책 (Google Classroom 의미):
  - assignment_ref 글만 제출 가능
  - 과거 학기 강좌 read-only (409)
  - turned_in 상태에서는 첨부 수정 불가 — 제출 취소 후 수정
  - returned 후에도 학생이 수정·재제출 가능 (Google과 동일)
  - 기한 지나도 제출 가능, is_late로 표시
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import DEFAULT_STORAGE_ROOT, ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.semester import get_active_semester_id_or_404
from app.core.upload import POLICY_CLASSROOM, check_extension, validate_upload
from app.models.classroom import (
    Course, CoursePost, CoursePostSubmission, CourseStudent,
    PostAttachmentCopy, PostPrivateComment,
)
from app.models.user import User
from app.modules.classroom.router import router
from app.modules.classroom.schemas import Attachment
from app.modules.classroom.teachers import is_course_editor_or_admin

SUBMISSIONS_DIR = DEFAULT_STORAGE_ROOT / "classroom" / "submissions"

# 학생용 사본/자료 열람 경로 (PostDetailView 학생 맵과 일치)
_STUDENT_COPY_URL = {
    "doc": lambda cid, rid: f"/s/classroom/{cid}/docs/{rid}",
    "sheet": lambda cid, rid: f"/s/sheets/{rid}",
    "deck": lambda cid, rid: f"/s/classroom/{cid}/decks/{rid}",
    "hwp": lambda cid, rid: f"/s/hwps/{rid}",
}


class SubmissionPut(BaseModel):
    """PUT my-submission — 첨부 목록 통째 교체."""
    attachments: list[Attachment] = Field(default_factory=list, max_length=20)


class SubmissionReturn(BaseModel):
    """POST submissions/{student_id}/return"""
    score: int | None = Field(None, ge=0, le=10000)
    feedback: str | None = Field(None, max_length=5000)


async def _get_assignment_post(db: AsyncSession, pid: int) -> tuple[CoursePost, Course]:
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    if p.post_type != "assignment_ref":
        raise HTTPException(400, "과제 글이 아닙니다")
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")
    return p, course


async def _assert_active_student(db: AsyncSession, course: Course, user: User) -> None:
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if not cs:
        raise HTTPException(403, "이 강좌의 수강생만 제출할 수 있습니다")


async def _assert_current_semester(db: AsyncSession, course: Course) -> None:
    sid = await get_active_semester_id_or_404(db)
    if course.semester_id != sid:
        raise HTTPException(409, "이전 학기 강좌에는 제출할 수 없습니다 (read-only).")


async def _get_or_create_submission(
    db: AsyncSession, pid: int, student_id: int,
) -> CoursePostSubmission:
    sub = (await db.execute(
        select(CoursePostSubmission).where(
            CoursePostSubmission.post_id == pid,
            CoursePostSubmission.student_id == student_id,
        )
    )).scalar_one_or_none()
    if not sub:
        sub = CoursePostSubmission(post_id=pid, student_id=student_id, status="assigned")
        db.add(sub)
        await db.flush()
    return sub


def _is_late(p: CoursePost, turned_in_at: datetime | None) -> bool:
    if not p.due_date or not turned_in_at:
        return False
    due = p.due_date
    t = turned_in_at
    # tz-naive 비교 방어
    if due.tzinfo is None and t.tzinfo is not None:
        t = t.replace(tzinfo=None)
    elif due.tzinfo is not None and t.tzinfo is None:
        t = t.replace(tzinfo=due.tzinfo)
    return t > due


async def _copies_for(db: AsyncSession, p: CoursePost, course: Course, student_id: int) -> list[dict]:
    """학생별 사본(share_mode=copy 첨부) — 제출 카드에 자동 노출."""
    rows = (await db.execute(
        select(PostAttachmentCopy).where(
            PostAttachmentCopy.post_id == p.id,
            PostAttachmentCopy.student_id == student_id,
        )
    )).scalars().all()
    from app.modules.classroom.posts import _att_title_sources
    sources = _att_title_sources()
    out = []
    for r in rows:
        url_fn = _STUDENT_COPY_URL.get(r.copy_type)
        title = None
        src = sources.get(r.copy_type)
        if src:
            obj = await db.get(src[0], r.copy_id)
            title = getattr(obj, "title", None) if obj else None
        out.append({
            "copy_type": r.copy_type,
            "copy_id": r.copy_id,
            "title": title or f"내 사본 ({r.copy_type})",
            "url": url_fn(course.id, r.copy_id) if url_fn else None,
        })
    return out


def _submission_dict(sub: CoursePostSubmission, p: CoursePost) -> dict:
    return {
        "id": sub.id,
        "post_id": sub.post_id,
        "status": sub.status,
        "attachments": sub.attachments or [],
        "turned_in_at": sub.turned_in_at.isoformat() if sub.turned_in_at else None,
        "returned_at": sub.returned_at.isoformat() if sub.returned_at else None,
        "score": sub.score,
        "feedback": sub.feedback,
        "is_late": _is_late(p, sub.turned_in_at),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 학생 — 내 과제
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/posts/{pid}/my-submission")
async def get_my_submission(
    pid: int,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course = await _get_assignment_post(db, pid)
    await _assert_active_student(db, course, user)
    sub = (await db.execute(
        select(CoursePostSubmission).where(
            CoursePostSubmission.post_id == pid,
            CoursePostSubmission.student_id == user.id,
        )
    )).scalar_one_or_none()
    copies = await _copies_for(db, p, course, user.id)
    if not sub:
        return {
            "id": None, "post_id": pid, "status": "assigned", "attachments": [],
            "turned_in_at": None, "returned_at": None, "score": None,
            "feedback": None, "is_late": False, "copies": copies,
        }
    return {**_submission_dict(sub, p), "copies": copies}


@router.put("/posts/{pid}/my-submission")
async def update_my_submission(
    pid: int, body: SubmissionPut,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course = await _get_assignment_post(db, pid)
    await _assert_active_student(db, course, user)
    await _assert_current_semester(db, course)
    sub = await _get_or_create_submission(db, pid, user.id)
    if sub.status == "turned_in":
        raise HTTPException(409, "제출된 과제입니다. 제출 취소 후 수정하세요.")
    sub.attachments = [a.model_dump(exclude_none=True) for a in body.attachments]
    await db.flush()
    return _submission_dict(sub, p)


@router.post("/posts/{pid}/my-submission/files")
async def upload_submission_file(
    pid: int, request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """제출용 파일 업로드 — 검증 + 저장 + 제출 첨부에 자동 추가."""
    p, course = await _get_assignment_post(db, pid)
    await _assert_active_student(db, course, user)
    await _assert_current_semester(db, course)
    sub = await _get_or_create_submission(db, pid, user.id)
    if sub.status == "turned_in":
        raise HTTPException(409, "제출된 과제입니다. 제출 취소 후 수정하세요.")
    if len(sub.attachments or []) >= 20:
        raise HTTPException(400, "첨부는 최대 20개입니다")

    data = await validate_upload(file, POLICY_CLASSROOM)
    ext = check_extension(file.filename, POLICY_CLASSROOM)

    await ensure_dir_async(SUBMISSIONS_DIR)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    await write_bytes_async(SUBMISSIONS_DIR / stored_name, data)

    file_url = f"/storage/classroom/submissions/{stored_name}"
    original_name = (file.filename or stored_name).strip()
    item = {
        "type": "file", "title": original_name,
        "file_url": file_url, "file_name": original_name,
    }
    sub.attachments = list(sub.attachments or []) + [item]
    await db.flush()
    await log_action(
        db, user, "classroom.submission.upload",
        target=f"post:{pid} bytes:{len(data)} ext:{ext}", request=request,
    )
    return {"attachment": item, "submission": _submission_dict(sub, p)}


@router.post("/posts/{pid}/my-submission/turn-in")
async def turn_in(
    pid: int, request: Request,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course = await _get_assignment_post(db, pid)
    await _assert_active_student(db, course, user)
    await _assert_current_semester(db, course)
    sub = await _get_or_create_submission(db, pid, user.id)
    if sub.status == "turned_in":
        raise HTTPException(409, "이미 제출했습니다")
    sub.status = "turned_in"
    sub.turned_in_at = datetime.now(timezone.utc)
    await db.flush()
    await log_action(db, user, "classroom.submission.turn_in", target=f"post:{pid}", request=request)

    # 알림: 글 작성 교사 + 강좌 owner (best-effort)
    try:
        from app.services.notification import notify_users
        targets = {uid for uid in (p.author_id, course.teacher_id) if uid}
        await notify_users(
            db, user_ids=list(targets),
            type="classroom_submission",
            title=f"과제 제출: {p.title}",
            body=f"{user.name} 학생이 과제를 제출했습니다.",
            link_url=f"/classroom/{course.id}/posts/{p.id}",
            source_user_id=user.id,
        )
    except Exception:
        pass
    return _submission_dict(sub, p)


@router.post("/posts/{pid}/my-submission/unsubmit")
async def unsubmit(
    pid: int, request: Request,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course = await _get_assignment_post(db, pid)
    await _assert_active_student(db, course, user)
    await _assert_current_semester(db, course)
    sub = (await db.execute(
        select(CoursePostSubmission).where(
            CoursePostSubmission.post_id == pid,
            CoursePostSubmission.student_id == user.id,
        )
    )).scalar_one_or_none()
    if not sub or sub.status != "turned_in":
        raise HTTPException(409, "제출 상태가 아닙니다")
    sub.status = "assigned"
    await db.flush()
    await log_action(db, user, "classroom.submission.unsubmit", target=f"post:{pid}", request=request)
    return _submission_dict(sub, p)


# ─────────────────────────────────────────────────────────────────────────────
# 교사 — 제출 현황 + 반환
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/posts/{pid}/submissions")
async def list_submissions(
    pid: int,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course = await _get_assignment_post(db, pid)
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사만 제출 현황을 볼 수 있습니다")

    students = (await db.execute(
        select(CourseStudent, User).join(User, User.id == CourseStudent.student_id).where(
            CourseStudent.course_id == course.id,
            CourseStudent.status == "active",
        )
    )).all()
    subs = {
        s.student_id: s
        for s in (await db.execute(
            select(CoursePostSubmission).where(CoursePostSubmission.post_id == pid)
        )).scalars().all()
    }

    # 학생 '이상없음' 확인 상태 (kind=submission, ref_key=제출물 id)
    from app.models.confirmation import StudentConfirmation
    sub_ids = [str(s.id) for s in subs.values()]
    acks: dict[str, StudentConfirmation] = {}
    if sub_ids:
        acks = {
            c.ref_key: c
            for c in (await db.execute(
                select(StudentConfirmation).where(
                    StudentConfirmation.kind == "submission",
                    StudentConfirmation.ref_key.in_(sub_ids),
                )
            )).scalars().all()
        }

    items = []
    counts = {"turned_in": 0, "returned": 0, "assigned": 0}
    for cs, u in students:
        sub = subs.get(cs.student_id)
        status = sub.status if sub else "assigned"
        counts[status] = counts.get(status, 0) + 1
        ack = acks.get(str(sub.id)) if sub else None
        items.append({
            "student_id": cs.student_id,
            "name": u.name,
            "grade": u.grade,
            "class_number": u.class_number,
            "student_number": u.student_number,
            "status": status,
            "turned_in_at": sub.turned_in_at.isoformat() if sub and sub.turned_in_at else None,
            "is_late": _is_late(p, sub.turned_in_at) if sub else False,
            "score": sub.score if sub else None,
            "feedback": sub.feedback if sub else None,
            "attachments": (sub.attachments or []) if sub else [],
            "ack": {"status": ack.status, "comment": ack.comment} if ack else None,
        })
    # 학년-반-번호 순
    items.sort(key=lambda x: (
        x["grade"] or 99, x["class_number"] or 99, x["student_number"] or 9999, x["name"],
    ))
    return {"items": items, "counts": counts, "total": len(items)}


# ─────────────────────────────────────────────────────────────────────────────
# 비공개 댓글 — 학생 ↔ 교사 1:1 (Google Classroom Private comments)
# ─────────────────────────────────────────────────────────────────────────────


class PrivateCommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=3000)
    # 교사가 답할 때 대상 학생 (학생 본인 호출 시 무시)
    student_id: int | None = None


async def _resolve_private_thread(
    db: AsyncSession, user: User, pid: int, student_id: int | None,
) -> tuple[CoursePost, Course, int, bool]:
    """비공개 댓글 스레드 접근 해석 → (post, course, thread_student_id, is_teacher).

    학생: 본인 스레드만 (active 수강생). 교사(editor/admin): student_id 필수.
    """
    p, course = await _get_assignment_post(db, pid)
    if await is_course_editor_or_admin(db, course, user):
        if not student_id:
            raise HTTPException(400, "student_id가 필요합니다 (교사)")
        cs = (await db.execute(
            select(CourseStudent).where(
                CourseStudent.course_id == course.id,
                CourseStudent.student_id == student_id,
                CourseStudent.status == "active",
            )
        )).scalar_one_or_none()
        if not cs:
            raise HTTPException(404, "이 강좌의 수강생이 아닙니다")
        return p, course, student_id, True
    await _assert_active_student(db, course, user)
    return p, course, user.id, False


@router.get("/posts/{pid}/private-comments")
async def list_private_comments(
    pid: int,
    student_id: int | None = None,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course, sid, _ = await _resolve_private_thread(db, user, pid, student_id)
    rows = (await db.execute(
        select(PostPrivateComment, User.name)
        .join(User, User.id == PostPrivateComment.author_id, isouter=True)
        .where(
            PostPrivateComment.post_id == pid,
            PostPrivateComment.student_id == sid,
        )
        .order_by(PostPrivateComment.created_at, PostPrivateComment.id)
        .limit(200)
    )).all()
    return {
        "items": [
            {
                "id": c.id,
                "author_id": c.author_id,
                "author_name": name,
                "is_student_author": c.author_id == c.student_id,
                "content": c.content,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c, name in rows
        ]
    }


@router.post("/posts/{pid}/private-comments")
async def create_private_comment(
    pid: int, body: PrivateCommentCreate, request: Request,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    p, course, sid, is_teacher = await _resolve_private_thread(db, user, pid, body.student_id)
    c = PostPrivateComment(
        post_id=pid, student_id=sid, author_id=user.id,
        content=body.content.strip(),
    )
    db.add(c)
    await db.flush()
    await db.refresh(c)  # server_default created_at 채움
    await log_action(
        db, user, "classroom.private_comment.create",
        target=f"post:{pid} student:{sid}", request=request,
    )
    # 알림 (best-effort): 학생 작성 → 교사들 / 교사 작성 → 학생
    try:
        from app.services.notification import notify_users
        if is_teacher:
            targets, link = [sid], f"/s/classroom/{course.id}/posts/{p.id}"
        else:
            targets = [uid for uid in {p.author_id, course.teacher_id} if uid]
            link = f"/classroom/{course.id}/posts/{p.id}"
        await notify_users(
            db, user_ids=targets,
            type="classroom_private_comment",
            title=f"비공개 댓글: {p.title}",
            body=body.content.strip()[:200],
            link_url=link,
            source_user_id=user.id,
        )
    except Exception:
        pass
    return {
        "id": c.id, "author_id": c.author_id, "author_name": user.name,
        "is_student_author": c.author_id == sid,
        "content": c.content,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.post("/posts/{pid}/submissions/{student_id}/return")
async def return_submission(
    pid: int, student_id: int, body: SubmissionReturn, request: Request,
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    """채점 반환 — 점수·피드백과 함께 돌려주기 (미제출 학생에게도 가능)."""
    p, course = await _get_assignment_post(db, pid)
    if not await is_course_editor_or_admin(db, course, user):
        raise HTTPException(403, "강좌 교사만 반환할 수 있습니다")
    # 대상이 이 강좌 active 학생인지
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == course.id,
            CourseStudent.student_id == student_id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if not cs:
        raise HTTPException(404, "이 강좌의 수강생이 아닙니다")
    if body.score is not None and p.max_score is not None and body.score > p.max_score:
        raise HTTPException(400, f"점수는 최대 {p.max_score}점입니다")

    sub = await _get_or_create_submission(db, pid, student_id)
    sub.status = "returned"
    sub.returned_at = datetime.now(timezone.utc)
    sub.graded_by = user.id
    if body.score is not None:
        sub.score = body.score
    if body.feedback is not None:
        sub.feedback = body.feedback.strip() or None
    await db.flush()
    await log_action(
        db, user, "classroom.submission.return",
        target=f"post:{pid} student:{student_id} score:{sub.score}", request=request,
    )
    try:
        from app.services.notification import notify_users
        score_txt = f" (점수 {sub.score}점)" if sub.score is not None else ""
        await notify_users(
            db, user_ids=[student_id],
            type="classroom_submission_returned",
            title=f"과제 반환: {p.title}",
            body=f"교사가 과제를 돌려줬습니다{score_txt}.",
            link_url=f"/s/classroom/{course.id}/posts/{p.id}",
            source_user_id=user.id,
        )
    except Exception:
        pass
    return _submission_dict(sub, p)
