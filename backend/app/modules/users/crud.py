"""사용자 CRUD endpoints — list, create, update, delete.

비-관리자 권한 상승 차단 + 마지막 super_admin 보호 + 교사 열람 범위 정책 반영.

router 객체는 router.py에서 공유. router.py 끝의 'from . import crud'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import hash_password
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.quota import assign_default_quota
from app.models.user import User
from app.modules.users.schemas import UserCreate, UserUpdate

from app.modules.users.router import router
from app.modules.users._helpers import (
    ADMIN_ROLES, VALID_ROLES,
    _ensure_not_last_super_admin, _is_admin, _user_response,
)


@router.get("")
async def list_users(
    role: str | None = None,
    grade: int | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 50,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    query = select(User)

    if role:
        query = query.where(User.role == role)
    if grade is not None:
        query = query.where(User.grade == grade)
    if status:
        query = query.where(User.status == status)
    if search:
        query = query.where(
            (User.name.ilike(f"%{search}%")) | (User.email.ilike(f"%{search}%"))
        )

    # 지정관리자는 자신보다 하위 역할만 조회
    if user.role == "designated_admin":
        query = query.where(User.role.in_(["teacher", "staff", "student"]))

    # 교사 열람 범위 정책: 학생 조회 시 정책에 따라 제한
    # (super_admin/designated_admin은 무관, scope="all"이면 무관)
    if user.role in ("teacher", "staff") and (role == "student" or role is None):
        from app.core.visibility import visible_student_user_ids
        from app.core.semester import get_active_semester_id_or_404
        try:
            sid = await get_active_semester_id_or_404(db)
            visible = await visible_student_user_ids(db, user, sid)
            if visible is not None:
                # 학생 user_id를 visible 집합으로 제한. 비학생은 그대로 보임.
                if visible:
                    query = query.where(
                        (User.role != "student") | (User.id.in_(visible))
                    )
                else:
                    query = query.where(User.role != "student")
        except HTTPException:
            # 현재 학기 미설정 — 정책 적용 불가, 일단 통과
            pass

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(User.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    users = result.scalars().all()

    return {
        "items": [_user_response(u) for u in users],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.post("")
async def create_user(
    body: UserCreate,
    request: Request,
    user: User = Depends(require_permission("user.manage.create")),
    db: AsyncSession = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"유효하지 않은 역할: {body.role}")

    # 비-관리자는 역할 지정 자체 차단 (이중 방어 — 권한 매트릭스 오설정 대비)
    if not _is_admin(user) and body.role != "student":
        raise HTTPException(403, "역할 지정은 관리자만 가능합니다")

    # 지정관리자는 super_admin/designated_admin 생성 불가
    if user.role == "designated_admin" and body.role in ADMIN_ROLES:
        raise HTTPException(403, "상위 역할의 사용자를 생성할 수 없습니다")

    # 이메일 중복 체크
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "이미 등록된 이메일입니다")

    password = body.password or settings.DEFAULT_USER_PASSWORD

    new_user = User(
        email=body.email,
        name=body.name,
        username=body.username,
        password_hash=hash_password(password),
        role=body.role,
        status="approved",
        grade=body.grade,
        class_number=body.class_number,
        student_number=body.student_number,
        department=body.department,
        must_change_password=True,
    )
    assign_default_quota(new_user)
    db.add(new_user)
    await db.flush()

    await log_action(db, user, "user_created", target=body.email, request=request)
    return _user_response(new_user)


@router.put("/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    user: User = Depends(require_permission("user.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")

    # 본인이 본인 role/status를 직접 변경 차단 (잠김 방지 + 권한 상승 차단)
    if target.id == user.id:
        if body.role is not None and body.role != user.role:
            raise HTTPException(400, "본인의 역할은 직접 변경할 수 없습니다")
        if body.status is not None and body.status != user.status:
            raise HTTPException(400, "본인의 상태는 직접 변경할 수 없습니다")

    # 지정관리자는 상위 역할 수정 불가
    if user.role == "designated_admin" and target.role in ADMIN_ROLES:
        raise HTTPException(403, "상위 역할의 사용자를 수정할 수 없습니다")

    # role 변경은 관리자만 (이중 방어 — 권한 매트릭스 오설정 대비)
    if body.role is not None and body.role != target.role and not _is_admin(user):
        raise HTTPException(403, "역할 변경은 관리자만 가능합니다")

    role_or_status_changed = False
    if body.name is not None:
        target.name = body.name
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(400, f"유효하지 않은 역할: {body.role}")
        if user.role == "designated_admin" and body.role in ADMIN_ROLES:
            raise HTTPException(403, "상위 역할로 변경할 수 없습니다")
        if body.role != target.role:
            # super_admin → 다른 role로 강등 시 마지막 super_admin 보호
            await _ensure_not_last_super_admin(db, target)
            role_or_status_changed = True
        target.role = body.role
    if body.status is not None:
        if body.status == "disabled" and target.status != "disabled":
            await _ensure_not_last_super_admin(db, target)
        if body.status != target.status:
            role_or_status_changed = True
        target.status = body.status
    if body.grade is not None:
        target.grade = body.grade
    if body.class_number is not None:
        target.class_number = body.class_number
    if body.student_number is not None:
        target.student_number = body.student_number
    if body.department is not None:
        target.department = body.department

    await db.flush()

    # role/status가 바뀌면 stale 권한 차단
    if role_or_status_changed:
        from app.modules.permissions.router import _invalidate_user_sessions
        await _invalidate_user_sessions(db, target.id)
        await db.flush()

    await log_action(db, user, "user_updated", target=target.email, request=request)
    return _user_response(target)


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    user: User = Depends(require_permission("user.manage.delete")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.id == user.id:
        raise HTTPException(400, "본인을 직접 삭제할 수 없습니다")
    if target.role == "super_admin":
        raise HTTPException(403, "최고관리자는 삭제할 수 없습니다")
    # 지정관리자가 다른 관리자(designated_admin) 삭제 차단
    if user.role == "designated_admin" and target.role == "designated_admin":
        raise HTTPException(403, "다른 지정관리자는 최고관리자만 삭제할 수 있습니다")

    target.status = "disabled"
    await db.flush()

    # 즉시 세션 차단 (disabled 사용자는 더 이상 토큰 갱신 불가)
    from app.modules.permissions.router import _invalidate_user_sessions
    await _invalidate_user_sessions(db, target.id)
    await db.flush()

    await log_action(db, user, "user_disabled", target=target.email, request=request)
    return {"ok": True}
