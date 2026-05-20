"""학생 본인 산출물 (자유 업로드) endpoints.

학생이 자유 산출물 업로드/관리. 공개 산출물 갤러리는 본 파일 마지막에 별도 endpoint.
교사가 보는 산출물 갤러리는 portfolio/teacher_views.py.

router 객체는 router.py에서 공유. router.py 끝의 'from . import artifacts'로 등록.
"""

import os
import time
from pathlib import Path

from fastapi import Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.upload import POLICY_ARTIFACT, validate_upload
from app.models.student_self import StudentArtifact
from app.models.user import User
from app.modules.student_self.schemas import ArtifactUpdate

from app.modules.student_self.router import router
from app.modules.student_self._helpers import _artifact_to_dict, _require_student


ARTIFACT_DIR = Path(__file__).resolve().parents[3] / "storage" / "artifacts"


@router.get("/artifacts")
async def list_my_artifacts(
    category: str | None = None,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    q = select(StudentArtifact).where(StudentArtifact.student_id == user.id)
    if category:
        q = q.where(StudentArtifact.category == category)
    rows = (await db.execute(q.order_by(desc(StudentArtifact.created_at)))).scalars().all()
    return {"items": [_artifact_to_dict(a) for a in rows]}


@router.post("/artifacts")
async def create_artifact(
    title: str = Form(...),
    description: str | None = Form(None),
    category: str = Form("other"),
    external_link: str | None = Form(None),
    is_public: bool = Form(False),
    tags: str | None = Form(None),  # comma-separated
    file: UploadFile | None = File(None),
    request: Request = None,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)

    file_url = None
    file_name = None
    file_size = None
    mime_type = None

    if file and file.filename:
        # POLICY_ARTIFACT: 확장자 화이트리스트 + 100MB 한도 + MIME 검증
        data = await validate_upload(file, POLICY_ARTIFACT)

        from app.core.files import ensure_dir_async, write_bytes_async
        student_dir = ARTIFACT_DIR / str(user.id)
        await ensure_dir_async(student_dir)
        ts = int(time.time())
        safe_name = f"{ts}_{os.path.basename(file.filename)}"
        target = student_dir / safe_name
        await write_bytes_async(target, data)
        file_url = f"/storage/artifacts/{user.id}/{safe_name}"
        file_name = file.filename
        file_size = len(data)
        mime_type = file.content_type

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()] if tags else []

    a = StudentArtifact(
        student_id=user.id,
        title=title, description=description, category=category,
        file_url=file_url, file_name=file_name,
        file_size=file_size, mime_type=mime_type,
        external_link=external_link, tags=tag_list,
        is_public=is_public,
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "student_artifact.create", target=f"id:{a.id}", request=request)
    return _artifact_to_dict(a)


@router.put("/artifacts/{aid}")
async def update_artifact(
    aid: int, body: ArtifactUpdate, request: Request,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    a = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.id == aid, StudentArtifact.student_id == user.id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    patch = body.model_dump(exclude_unset=True)
    for f, v in patch.items():
        setattr(a, f, v)
    await log_action(db, user, "student_artifact.update", target=f"id:{aid}", request=request)
    return _artifact_to_dict(a)


@router.delete("/artifacts/{aid}")
async def delete_artifact(
    aid: int, request: Request,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    a = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.id == aid, StudentArtifact.student_id == user.id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    # 파일 정리
    if a.file_url:
        rel = a.file_url.replace("/storage/", "", 1)
        full = ARTIFACT_DIR.parent / rel
        try:
            if full.exists():
                full.unlink()
        except OSError:
            pass
    await db.delete(a)
    await log_action(db, user, "student_artifact.delete", target=f"id:{aid}", request=request)
    return {"ok": True}


# 공개된 다른 학생 산출물 (과거/동기 참고용)
@router.get("/artifacts/public")
async def list_public_artifacts(
    category: str | None = None,
    limit: int = Query(50, le=200),
    user: User = Depends(require_permission("student.artifact.view_public")),
    db: AsyncSession = Depends(get_db),
):
    q = (select(StudentArtifact, User.name)
         .join(User, User.id == StudentArtifact.student_id)
         .where(StudentArtifact.is_public == True))
    if category:
        q = q.where(StudentArtifact.category == category)
    q = q.order_by(desc(StudentArtifact.created_at)).limit(limit)
    rows = (await db.execute(q)).all()
    return {"items": [
        {**_artifact_to_dict(a), "author_name": name}
        for a, name in rows
    ]}
