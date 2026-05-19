"""피드백 라우터 — 건의사항, 오류 신고"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_current_user
from app.core.permissions import require_admin
from app.models.feedback import Feedback
from app.models.user import User
from app.modules.feedback.schemas import FeedbackCreate, FeedbackStatusUpdate

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("")
async def create_feedback(
    body: FeedbackCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    f = Feedback(
        user_id=user.id,
        feedback_type=body.feedback_type,
        content=body.content,
        page_url=body.page_url,
    )
    db.add(f)
    await db.flush()
    return {"id": f.id}


@router.get("/mine")
async def my_feedback(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Feedback).where(Feedback.user_id == user.id)
        .order_by(desc(Feedback.created_at))
    )).scalars().all()
    return {"items": [{
        "id": f.id, "feedback_type": f.feedback_type,
        "content": f.content, "status": f.status,
        "admin_note": f.admin_note,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    } for f in rows]}


@router.get("")
async def list_feedback(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    q = select(Feedback)
    cq = select(func.count(Feedback.id))
    if status:
        q = q.where(Feedback.status == status)
        cq = cq.where(Feedback.status == status)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Feedback.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": f.id, "user_id": f.user_id,
            "feedback_type": f.feedback_type, "content": f.content,
            "page_url": f.page_url, "status": f.status,
            "admin_note": f.admin_note,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        } for f in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.patch("/{fid}")
async def update_feedback_status(
    fid: int, body: FeedbackStatusUpdate,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    f = (await db.execute(select(Feedback).where(Feedback.id == fid))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "피드백을 찾을 수 없습니다")
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        setattr(f, k, v)
    await db.flush()
    return {"ok": True}


@router.post("/{fid}/ai-request")
async def create_ai_request_from_feedback(
    fid: int,
    user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    """피드백 → AI 개발 요청 draft 자동 생성.

    피드백 내용을 prompt로, page_url을 추가 컨텍스트로 자동 채움.
    이후 사용자는 /system/ai-developer 페이지에서 검토·실행.

    권한: require_admin (super_admin + designated_admin)
          단 실제 생성/적용은 system.ai_developer.use 권한 필요 (지정관리자도 가능).
    """
    from app.models.feedback import DevRequest

    f = (await db.execute(select(Feedback).where(Feedback.id == fid))).scalar_one_or_none()
    if not f:
        raise HTTPException(404, "피드백을 찾을 수 없습니다")

    # AI 개발자 사용 권한 확인
    from app.core.permissions import resolve_permissions
    perms = await resolve_permissions(db, user)
    if "system.ai_developer.use" not in perms:
        raise HTTPException(
            403,
            "AI 개발자 사용 권한이 없습니다 (system.ai_developer.use). "
            "최고관리자에게 권한 요청하세요.",
        )

    # 기존 DevRequest 있으면 reuse (멱등성)
    existing = (await db.execute(
        select(DevRequest).where(DevRequest.feedback_id == fid)
        .order_by(desc(DevRequest.created_at)).limit(1)
    )).scalar_one_or_none()
    if existing and existing.status in ("draft", "generated", "applied"):
        return {"id": existing.id, "status": existing.status, "reused": True}

    # type 추론 — feedback_type을 request_type으로 매핑
    type_map = {
        "bug": "bugfix",
        "feature": "feature",
        "ui": "ui_change",
        "improvement": "feature",
    }
    request_type = type_map.get(f.feedback_type, "feature")

    title = f"[피드백 #{fid}] {(f.content or '')[:60]}"
    prompt_parts = [
        f"## 사용자 피드백 (유형: {f.feedback_type})",
        "",
        f.content or "",
    ]
    if f.page_url:
        prompt_parts.extend([
            "",
            f"## 보고된 페이지",
            f.page_url,
        ])
    prompt_parts.extend([
        "",
        "## 작업 지시",
        "위 사용자 피드백을 바탕으로 개선/수정을 구현하세요.",
        "- 기존 코드 패턴과 컨벤션 유지",
        "- 한국어 UI 텍스트",
        "- 최소한의 변경",
        "- CLAUDE.md의 보안·확장 규칙 준수",
    ])

    new_req = DevRequest(
        feedback_id=fid,
        title=title,
        prompt="\n".join(prompt_parts),
        request_type=request_type,
        status="draft",
        created_by_id=user.id,
    )
    db.add(new_req)
    await db.flush()
    await db.refresh(new_req)

    # 피드백 상태 갱신
    if f.status in (None, "open"):
        f.status = "in_progress"
        f.admin_note = (f.admin_note or "") + f"\n[AI 의뢰됨] DevRequest #{new_req.id}"

    return {"id": new_req.id, "status": new_req.status, "reused": False}
