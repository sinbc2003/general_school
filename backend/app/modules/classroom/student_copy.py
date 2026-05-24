"""학생별 첨부 사본 — share_mode='copy' 첨부의 lazy 사본 생성 + 채점용 list.

Phase 2 — 글 첨부의 학생별 사본 워크플로우:
- 학생이 share_mode='copy' 첨부 클릭 → POST .../my-copy → 본인 사본 자동 생성
  (강좌 active 수강생만, 본인 quota 차감, 교사도 멤버로 추가)
- 교사 채점: GET .../copies → 모든 학생 사본 list

설계 결정:
- PostAttachmentCopy 모델 (post_id+attachment_idx+student_id UNIQUE)
- 사본 자료는 access_mode='specific_users' + members=[학생, 강좌 교사들]
  → 다른 학생 사본 보기 자동 차단 (자료 본체 ACL이 보호)
- copy_id는 generic int (type별 별도 모델) — fetch 시 model 분기
- lazy 정책: 강좌에 학기 중 추가된 학생도 사본 클릭 시 자동 생성

router 객체는 router.py에서 공유. router.py 끝의 'from . import student_copy'로 등록.
"""

from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import (
    ensure_dir_async,
    read_bytes_async,
    write_bytes_async,
)
from app.core.permissions import require_permission
from app.core.quota import check_quota, consume_quota
from app.models import (
    ClassroomDocument,
    ClassroomHwp,
    ClassroomPresentation,
    ClassroomSheet,
    ClassroomSlide,
    Course,
    CoursePost,
    CourseStudent,
    CourseTeacher,
    DocumentMember,
    HwpMember,
    PostAttachmentCopy,
    PresentationMember,
    SheetMember,
    User,
)
from app.modules.classroom.router import router
from app.modules.classroom.teachers import is_course_editor


STORAGE_ROOT = Path("storage")

# att.type → (Model, MemberModel, member FK column name)
_TYPE_MAP: dict[str, tuple] = {
    "doc":   (ClassroomDocument, DocumentMember, "document_id"),
    "sheet": (ClassroomSheet, SheetMember, "sheet_id"),
    "deck":  (ClassroomPresentation, PresentationMember, "presentation_id"),
    "hwp":   (ClassroomHwp, HwpMember, "hwp_id"),
}


def _copy_url_for(copy_type: str, copy_id: int, *, student_mode: bool) -> str:
    """교사 vs 학생 view URL 분기."""
    prefix = "/s" if student_mode else ""
    if copy_type == "doc":
        return f"{prefix}/docs/{copy_id}"
    if copy_type == "sheet":
        return f"{prefix}/sheets/{copy_id}"
    if copy_type == "deck":
        return f"{prefix}/docs/decks/{copy_id}"
    if copy_type == "hwp":
        return f"{prefix}/hwps/{copy_id}"
    return "/"


async def _create_student_copy(
    db: AsyncSession,
    att_type: str,
    src_id: int,
    student: User,
    teacher_ids: list[int],
    title_prefix: str = "",
) -> int:
    """학생용 사본 자료 생성 → 새 자료 id 반환.

    원본을 type별 모델로 fetch → 같은 type 새 row(owner=student, specific_users)
    + yjs_state/plain_text/settings 복제. HWP는 실 파일도 새 경로로 복사.
    deck은 ClassroomSlide rows도 복제.
    교사들은 별도 멤버 row(editor)로 추가 (채점 시 접근).
    """
    if att_type not in _TYPE_MAP:
        raise HTTPException(400, f"사본 미지원 type: {att_type}")
    Model, MemberModel, member_fk = _TYPE_MAP[att_type]

    src = await db.get(Model, src_id)
    if not src:
        raise HTTPException(404, f"원본 자료 없음 ({att_type}#{src_id})")
    # 삭제된 자료는 사본 생성 불가
    if getattr(src, "deleted_at", None):
        raise HTTPException(404, f"삭제된 자료입니다 ({att_type}#{src_id})")

    bytes_needed = getattr(src, "storage_bytes", 0) or 0
    if bytes_needed:
        check_quota(student, bytes_needed)

    student_label = student.name or f"학생{student.id}"
    new_title = (
        f"{title_prefix} - {src.title}" if title_prefix else src.title
    )[:255]

    # type별 새 row (필드 다름)
    common = dict(
        owner_id=student.id,
        course_id=None,
        title=new_title,
        access_mode="specific_users",
        storage_bytes=bytes_needed,
    )
    if att_type == "doc":
        new_obj = ClassroomDocument(
            **common, yjs_state=src.yjs_state, plain_text=src.plain_text,
        )
    elif att_type == "sheet":
        new_obj = ClassroomSheet(
            **common, yjs_state=src.yjs_state, settings=src.settings,
        )
    elif att_type == "deck":
        new_obj = ClassroomPresentation(
            **common, yjs_state=src.yjs_state, settings=src.settings,
        )
    elif att_type == "hwp":
        new_obj = ClassroomHwp(**common)  # file_path는 flush 후 채움
    else:  # pragma: no cover — _TYPE_MAP 가드로 도달 X
        raise HTTPException(400, f"미지원 type: {att_type}")

    db.add(new_obj)
    copied_hwp_path: Path | None = None
    try:
        await db.flush()  # id 확보

        # HWP 파일 실 복사
        if att_type == "hwp" and getattr(src, "file_path", None):
            src_path = STORAGE_ROOT / src.file_path
            if await _async_exists(src_path):
                data = await read_bytes_async(src_path)
                fmt = src.file_format or "hwpx"
                token = secrets.token_urlsafe(16)
                new_rel = f"hwps/{new_obj.id}/{token}.{fmt}"
                new_full = STORAGE_ROOT / new_rel
                await ensure_dir_async(new_full.parent)
                await write_bytes_async(new_full, data)
                new_obj.file_path = new_rel
                new_obj.file_format = fmt
                copied_hwp_path = new_full

        # deck slides 복제
        if att_type == "deck":
            src_slides = (await db.execute(
                select(ClassroomSlide)
                .where(ClassroomSlide.presentation_id == src_id)
                .order_by(ClassroomSlide.order)
            )).scalars().all()
            for s in src_slides:
                db.add(ClassroomSlide(
                    presentation_id=new_obj.id,
                    order=s.order,
                    title=s.title,
                    yjs_state=s.yjs_state,
                    plain_text=s.plain_text,
                ))

        # 교사 멤버 추가 (채점용 접근)
        # owner는 별도 member 불필요. teacher_ids에 student.id 들어 있으면 skip.
        for tid in set(teacher_ids):
            if tid == student.id:
                continue
            db.add(MemberModel(**{member_fk: new_obj.id, "user_id": tid, "role": "editor"}))

        # quota 차감 (race 방지를 위해 flush 후)
        if bytes_needed:
            await consume_quota(db, student, bytes_needed, check=True)

        await db.flush()
    except Exception:
        # rollback — 자료 + HWP 파일 cleanup
        await db.rollback()
        if copied_hwp_path:
            try:
                copied_hwp_path.unlink(missing_ok=True)
            except Exception:
                pass
        raise

    return new_obj.id


async def _async_exists(p: Path) -> bool:
    import asyncio
    return await asyncio.to_thread(p.exists)


@router.post("/posts/{pid}/attachments/{idx}/my-copy")
async def get_or_create_my_copy(
    pid: int,
    idx: int,
    request: Request,
    user: User = Depends(require_permission("classroom.post.view")),
    db: AsyncSession = Depends(get_db),
):
    """학생용 — share_mode='copy' 첨부의 본인 사본 가져오기/생성 (lazy).

    - 강좌 active 수강생만
    - 사본 이미 있으면 그 link 반환 (is_new=false)
    - 없으면 신규 생성 + 본인 quota 차감 + 교사도 멤버 추가
    """
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404, "글 없음")
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404, "강좌 없음")

    # 강좌 active 수강생 확인
    cs = (await db.execute(
        select(CourseStudent).where(
            CourseStudent.course_id == p.course_id,
            CourseStudent.student_id == user.id,
            CourseStudent.status == "active",
        )
    )).scalar_one_or_none()
    if not cs:
        raise HTTPException(403, "강좌의 active 수강생만 사본을 만들 수 있습니다")

    # 첨부 검증
    attachments = p.attachments or []
    if idx < 0 or idx >= len(attachments):
        raise HTTPException(404, "첨부 항목 없음")
    att = attachments[idx] if isinstance(attachments[idx], dict) else {}
    share_mode = att.get("share_mode", "view")
    if share_mode != "copy":
        raise HTTPException(400, "이 첨부는 학생별 사본 모드가 아닙니다")
    att_type = att.get("type")
    if att_type not in _TYPE_MAP:
        raise HTTPException(400, f"사본 미지원 type: {att_type}")
    src_id_key = f"{att_type}_id"
    src_id = att.get(src_id_key)
    if not src_id:
        raise HTTPException(400, f"첨부에 {src_id_key} 누락")

    # 기존 사본 있으면 그대로 반환
    existing = (await db.execute(
        select(PostAttachmentCopy).where(
            PostAttachmentCopy.post_id == pid,
            PostAttachmentCopy.attachment_idx == idx,
            PostAttachmentCopy.student_id == user.id,
        )
    )).scalar_one_or_none()
    if existing:
        return {
            "is_new": False,
            "copy_type": existing.copy_type,
            "copy_id": existing.copy_id,
            "copy_url": _copy_url_for(
                existing.copy_type, existing.copy_id, student_mode=True,
            ),
        }

    # 교사 멤버 ids 수집 (강좌 owner + co_teachers)
    teacher_ids: list[int] = []
    if course.teacher_id:
        teacher_ids.append(course.teacher_id)
    co_ids = (await db.execute(
        select(CourseTeacher.user_id).where(CourseTeacher.course_id == course.id)
    )).scalars().all()
    teacher_ids.extend(co_ids)
    teacher_ids = list(dict.fromkeys(teacher_ids))  # 중복 제거 (순서 유지)

    # 사본 자료 생성
    new_copy_id = await _create_student_copy(
        db, att_type, src_id,
        student=user, teacher_ids=teacher_ids,
        title_prefix=user.name or f"학생{user.id}",
    )

    # 매핑 row
    mapping = PostAttachmentCopy(
        post_id=pid, attachment_idx=idx, student_id=user.id,
        copy_type=att_type, copy_id=new_copy_id,
    )
    db.add(mapping)
    await db.flush()

    await log_action(
        db, user, "classroom.post.copy_created",
        target=f"post_attachment_copy:{mapping.id}",
        request=request,
    )

    return {
        "is_new": True,
        "copy_type": att_type,
        "copy_id": new_copy_id,
        "copy_url": _copy_url_for(att_type, new_copy_id, student_mode=True),
    }


@router.get("/posts/{pid}/copies")
async def list_post_copies(
    pid: int,
    user: User = Depends(require_permission("classroom.post.write")),
    db: AsyncSession = Depends(get_db),
):
    """교사용 — 이 글의 모든 학생 사본 list. 채점 페이지에서 활용.

    - 강좌 editor (owner / co_teacher) 또는 admin만
    """
    p = await db.get(CoursePost, pid)
    if not p:
        raise HTTPException(404)
    course = await db.get(Course, p.course_id)
    if not course:
        raise HTTPException(404)

    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and not await is_course_editor(db, user, course):
        raise HTTPException(403, "강좌 교사만 볼 수 있습니다")

    rows = (await db.execute(
        select(PostAttachmentCopy, User)
        .join(User, PostAttachmentCopy.student_id == User.id)
        .where(PostAttachmentCopy.post_id == pid)
        .order_by(PostAttachmentCopy.attachment_idx, User.name)
    )).all()

    items = []
    for copy, student in rows:
        items.append({
            "id": copy.id,
            "attachment_idx": copy.attachment_idx,
            "student_id": student.id,
            "student_name": student.name,
            "student_grade": student.grade,
            "student_class": student.class_number,
            "student_number": student.student_number,
            "copy_type": copy.copy_type,
            "copy_id": copy.copy_id,
            "copy_url": _copy_url_for(copy.copy_type, copy.copy_id, student_mode=False),
            "created_at": copy.created_at.isoformat() if copy.created_at else None,
        })

    return {"items": items}
