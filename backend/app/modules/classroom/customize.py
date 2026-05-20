"""강좌 카드 디자인 커스터마이징 — 배경색·이미지·아이콘 + viewable_by.

엔드포인트:
  PATCH /api/classroom/courses/{cid}/customize  — 색·이미지url·아이콘·viewable_by 변경
  POST  /api/classroom/courses/{cid}/banner-image — 이미지 업로드 (자동 압축 → 200KB)

이미지:
  - JPG/PNG 업로드 → PIL로 리사이즈 max 800x500 + 압축 (quality 80) → JPEG로 저장
  - storage/classroom/banners/{course_id}_{uuid}.jpg
  - 소유자(owner) quota 차감 (storage_bytes 추적)
"""

from io import BytesIO
import os
import uuid

from fastapi import Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.quota import check_quota, consume_quota, release_quota
from app.core.upload import POLICY_IMAGE, validate_upload
from app.models import Course, User
from app.modules.classroom.router import router


PALETTE = [
    "#7986CB", "#33B679", "#8E63CE", "#E67C73", "#F6BF26", "#F4511E",
    "#039BE5", "#0B8043", "#3F51B5", "#D81B60", "#616161", "#0097A7",
]

BANNER_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "storage", "classroom", "banners",
)
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 입력 5MB 한도


class CustomizeBody(BaseModel):
    banner_color: str | None = Field(None, pattern="^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(None, max_length=50)
    clear_banner_image: bool = False
    # 열람 권한 변경 (super_admin/designated_admin만 — 라우터에서 별도 가드)
    viewable_by: str | None = Field(None, pattern="^(all_teachers|assigned_only)$")


@router.patch("/courses/{cid}/customize")
async def customize_course(
    cid: int,
    body: CustomizeBody,
    request: Request,
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """카드 디자인 변경. owner 또는 admin만."""
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")
    if not (user.role in ("super_admin", "designated_admin") or course.teacher_id == user.id):
        raise HTTPException(403, "강좌 소유자만 디자인을 변경할 수 있습니다")

    if body.banner_color is not None:
        course.banner_color = body.banner_color
    if body.icon is not None:
        course.icon = body.icon or None
    if body.clear_banner_image:
        course.banner_image_url = None
    if body.viewable_by is not None:
        # viewable_by 변경은 super_admin/designated_admin 전용
        if user.role not in ("super_admin", "designated_admin"):
            raise HTTPException(403, "강좌 열람 권한 변경은 관리자만 가능합니다")
        course.viewable_by = body.viewable_by

    await db.flush()
    await db.refresh(course)
    await log_action(
        db, user, "course_customize",
        target=f"course:{cid}", request=request,
    )
    return {
        "ok": True,
        "banner_color": course.banner_color,
        "icon": course.icon,
        "banner_image_url": course.banner_image_url,
    }


@router.post("/courses/{cid}/banner-image")
async def upload_banner_image(
    cid: int,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("classroom.course.view")),
    db: AsyncSession = Depends(get_db),
):
    """배너 이미지 업로드 + 자동 압축.

    1. 입력 5MB 초과 시 거부
    2. PIL로 max 800x500 리사이즈 + JPEG quality=80
    3. ~200KB 이내로 저장
    4. owner quota에 압축 후 크기 차감
    """
    course = await db.get(Course, cid)
    if not course:
        raise HTTPException(404, "강좌를 찾을 수 없습니다")
    if not (user.role in ("super_admin", "designated_admin") or course.teacher_id == user.id):
        raise HTTPException(403, "강좌 소유자만 이미지를 업로드할 수 있습니다")

    # 1) 입력 검증 + 읽기 (POLICY_IMAGE: ext/mime/size 일괄 검증)
    raw = await validate_upload(file, POLICY_IMAGE)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f"이미지가 너무 큽니다 (최대 5MB)")

    # 2) PIL 압축 (lazy import — 이 endpoint만 사용)
    try:
        from PIL import Image
    except ImportError:
        raise HTTPException(500, "Pillow 미설치 — pip install Pillow 필요")

    try:
        img = Image.open(BytesIO(raw))
        img = img.convert("RGB")  # JPEG는 RGBA 불가
        img.thumbnail((800, 500), Image.Resampling.LANCZOS)
        out = BytesIO()
        img.save(out, format="JPEG", quality=80, optimize=True)
        compressed = out.getvalue()
    except Exception as e:
        raise HTTPException(400, f"이미지 처리 실패: {e}")

    # 3) quota (owner) 차감
    owner = await db.get(User, course.teacher_id)
    if owner:
        check_quota(owner, len(compressed))

    # 4) 저장
    await ensure_dir_async(BANNER_DIR)
    fname = f"{cid}_{uuid.uuid4().hex[:12]}.jpg"
    fpath = os.path.join(BANNER_DIR, fname)
    await write_bytes_async(fpath, compressed)

    # 기존 이미지 quota 환원
    old_url = course.banner_image_url
    file_url = f"/storage/classroom/banners/{fname}"
    course.banner_image_url = file_url

    if owner:
        await consume_quota(db, owner, len(compressed), check=False, notify_threshold=False)

    # 기존 이미지 파일 삭제 + storage_bytes 환원은 best-effort
    if old_url:
        try:
            old_fname = old_url.split("/")[-1]
            old_path = os.path.join(BANNER_DIR, old_fname)
            if os.path.exists(old_path):
                old_size = os.path.getsize(old_path)
                os.unlink(old_path)
                if owner:
                    await release_quota(db, owner, old_size)
        except Exception:
            pass

    await db.flush()
    await log_action(
        db, user, "course_banner_upload",
        target=f"course:{cid}",
        detail=f"size={len(compressed)} url={file_url}",
        request=request,
    )
    return {
        "ok": True,
        "banner_image_url": file_url,
        "compressed_bytes": len(compressed),
    }
