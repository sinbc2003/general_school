"""사용자 CRUD endpoints — list, create, update, delete.

비-관리자 권한 상승 차단 + 마지막 super_admin 보호 + 교사 열람 범위 정책 반영.

router 객체는 router.py에서 공유. router.py 끝의 'from . import crud'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user, hash_password
from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.quota import assign_default_quota
from app.models.classroom import Course, CourseStudent
from app.models.course_teacher import CourseTeacher
from app.models.user import User
from app.modules.users.schemas import UserCreate, UserUpdate

from app.modules.users.router import router
from app.modules.users._helpers import (
    ADMIN_ROLES, VALID_ROLES,
    _ensure_not_last_super_admin, _is_admin, _user_response,
    phone_to_initial_password,
)


@router.get("/peers")
async def search_peers(
    role: str | None = None,
    grade: int | None = None,
    class_number: int | None = None,
    department_id: int | None = None,
    search: str | None = None,
    per_page: int = 30,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """공유 모달 / UserPicker 전용 검색 — 모든 role 호출 가능.

    - admin/teacher/staff: 전체 검색 (user.manage.view 동일 정책)
    - **student**: 본인 수강 강좌(active)의 다른 학생 + 그 강좌 교사 + 본인만
      → 개인정보 노출 차단. 모르는 다른 학년/반 학생 검색 불가.
    """
    # role별 허용 user_id 사전 계산
    allowed_ids: set[int] | None = None  # None = 제한 없음
    if user.role == "student":
        my_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        if not my_course_ids:
            return {"items": []}
        course_id_list = list(my_course_ids)
        peers = (await db.execute(
            select(CourseStudent.student_id).where(
                CourseStudent.course_id.in_(course_id_list),
                CourseStudent.status == "active",
            )
        )).scalars().all()
        owners = (await db.execute(
            select(Course.teacher_id).where(Course.id.in_(course_id_list))
        )).scalars().all()
        co_teachers = (await db.execute(
            select(CourseTeacher.user_id).where(CourseTeacher.course_id.in_(course_id_list))
        )).scalars().all()
        allowed_ids = set(peers) | set(owners) | set(co_teachers) | {user.id}
    elif user.role == "designated_admin":
        # 지정관리자는 super_admin 외 모두 (기존 list_users 정책 일관성)
        pass
    elif user.role not in ("super_admin", "teacher", "staff"):
        # 알려지지 않은 role — 안전상 본인만
        allowed_ids = {user.id}

    query = select(User).where(User.status != "disabled")
    if allowed_ids is not None:
        if not allowed_ids:
            return {"items": []}
        query = query.where(User.id.in_(allowed_ids))
    if role:
        _roles = [r.strip() for r in role.split(",") if r.strip()]
        if _roles:
            query = query.where(User.role.in_(_roles))
    if grade is not None:
        query = query.where(User.grade == grade)
    if class_number is not None:
        query = query.where(User.class_number == class_number)
    if department_id is not None:
        query = query.where(User.department_id == department_id)
    if search:
        query = query.where(
            (User.name.ilike(f"%{search}%")) | (User.email.ilike(f"%{search}%"))
        )
    if user.role == "designated_admin":
        query = query.where(User.role.in_(["teacher", "staff", "student"]))

    query = query.order_by(User.name).limit(per_page)
    rows = (await db.execute(query)).scalars().all()
    return {"items": [_user_response(u) for u in rows]}


@router.get("")
async def list_users(
    role: str | None = None,
    grade: int | None = None,
    class_number: int | None = None,
    department_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 50,
    user: User = Depends(require_permission("user.manage.view")),
    db: AsyncSession = Depends(get_db),
):
    query = select(User)

    if role:
        _roles = [r.strip() for r in role.split(",") if r.strip()]
        if _roles:
            query = query.where(User.role.in_(_roles))
    if grade is not None:
        query = query.where(User.grade == grade)
    if class_number is not None:
        query = query.where(User.class_number == class_number)
    if department_id is not None:
        query = query.where(User.department_id == department_id)
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


def _format_phone(phone: str | None) -> str | None:
    """전화번호 표준화 — 숫자만 추출 후 휴대폰 하이픈 형식(010-1234-5678).

    '-' 입력 여부와 무관하게 통일. 형식이 안 맞으면(02 등) 원본 유지.
    """
    if not phone:
        return phone
    import re
    d = re.sub(r"\D", "", phone)
    if len(d) == 11 and d.startswith("01"):
        return f"{d[:3]}-{d[3:7]}-{d[7:]}"
    if len(d) == 10 and d.startswith("01"):
        return f"{d[:3]}-{d[3:6]}-{d[6:]}"
    return phone.strip()


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

    # 초기 비밀번호 우선순위: 명시 비번(임시) → 전화번호 숫자 → 마지막 폴백(기본값).
    # 관리자 등록 시 비번을 안 주면 전화번호(있으면)가 초기 비번이 된다.
    password = body.password or phone_to_initial_password(body.phone) or settings.DEFAULT_USER_PASSWORD

    from datetime import datetime
    expires_at = None
    if body.expires_at:
        try:
            expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "expires_at 형식이 잘못됨 (ISO 8601 필요)")

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
        department_id=body.department_id,
        is_grade_lead=body.is_grade_lead,
        lead_grade=body.lead_grade,
        user_type=body.user_type or "regular",
        expires_at=expires_at,
        phone=_format_phone(body.phone),
        google_email=body.google_email,
        lifecycle_status=body.lifecycle_status or "active",
        must_change_password=True,
    )
    assign_default_quota(new_user)
    db.add(new_user)
    await db.flush()

    # 현재 학기 명단(enrollment) 자동 등록 — 담임/학급강좌/시간표 등 enrollment 기반 기능 연동.
    # 마법사가 계정만 만들고 학기 명단에 안 넣어 클래스룸 학생이 비던 문제를 근본 해결.
    try:
        from app.models.timetable import Semester, SemesterEnrollment
        cur = (await db.execute(
            select(Semester).where(Semester.is_current == True)
        )).scalar_one_or_none()
        if cur:
            dup = (await db.execute(select(SemesterEnrollment).where(
                SemesterEnrollment.semester_id == cur.id,
                SemesterEnrollment.user_id == new_user.id,
            ))).scalar_one_or_none()
            if not dup:
                db.add(SemesterEnrollment(
                    semester_id=cur.id, user_id=new_user.id, role=new_user.role,
                    status="active", grade=new_user.grade,
                    class_number=new_user.class_number, student_number=new_user.student_number,
                    department=new_user.department, phone=new_user.phone,
                ))
                await db.flush()
    except Exception as _e:
        import logging
        logging.getLogger(__name__).warning("enrollment auto-create fail: %s", _e)

    # 자동 폴더 동기화 (현재 학기 기준). 실패해도 사용자 생성은 막지 않음.
    try:
        from app.services.folder_seed import sync_user_folders
        await sync_user_folders(db, new_user)
    except Exception:
        pass

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
    # 자동 폴더 동기화 여부 판단용 — 영향 받는 필드 변경 시만 호출 (불필요한 작업 피함)
    folder_relevant_changed = False
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
            folder_relevant_changed = True
        target.role = body.role
    if body.status is not None:
        if body.status == "disabled" and target.status != "disabled":
            await _ensure_not_last_super_admin(db, target)
        if body.status != target.status:
            role_or_status_changed = True
        target.status = body.status
    if body.grade is not None and body.grade != target.grade:
        target.grade = body.grade
        folder_relevant_changed = True
    elif body.grade is not None:
        target.grade = body.grade
    if body.class_number is not None and body.class_number != target.class_number:
        target.class_number = body.class_number
        folder_relevant_changed = True
    elif body.class_number is not None:
        target.class_number = body.class_number
    if body.student_number is not None:
        target.student_number = body.student_number
    if body.department is not None:
        target.department = body.department
    if body.department_id is not None:
        new_dept = body.department_id if body.department_id > 0 else None
        if new_dept != target.department_id:
            folder_relevant_changed = True
        target.department_id = new_dept
    if body.is_grade_lead is not None and body.is_grade_lead != target.is_grade_lead:
        target.is_grade_lead = body.is_grade_lead
        folder_relevant_changed = True
    elif body.is_grade_lead is not None:
        target.is_grade_lead = body.is_grade_lead
    if body.lead_grade is not None:
        new_lg = body.lead_grade if body.lead_grade > 0 else None
        if new_lg != target.lead_grade:
            folder_relevant_changed = True
        target.lead_grade = new_lg
    if body.user_type is not None:
        target.user_type = body.user_type
    if body.expires_at is not None:
        from datetime import datetime
        if body.expires_at == "":
            target.expires_at = None
        else:
            try:
                target.expires_at = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
            except ValueError:
                raise HTTPException(400, "expires_at 형식이 잘못됨 (ISO 8601 필요)")
    if body.phone is not None:
        target.phone = _format_phone(body.phone)
    if body.google_email is not None:
        target.google_email = body.google_email
    if body.lifecycle_status is not None:
        target.lifecycle_status = body.lifecycle_status
    if body.quota_mb is not None:
        target.quota_bytes = max(0, body.quota_mb) * 1024 * 1024

    await db.flush()

    # role/status가 바뀌면 stale 권한 차단
    if role_or_status_changed:
        from app.modules.permissions.router import _invalidate_user_sessions
        await _invalidate_user_sessions(db, target.id)
        await db.flush()

    # 자동 폴더 동기화 — 영향 필드 변경 시만 (best-effort).
    if folder_relevant_changed:
        try:
            from app.services.folder_seed import sync_user_folders
            await sync_user_folders(db, target)
        except Exception:
            pass

    # role/status/is_grade_lead 변경은 권한·접근 범위에 영향 — 민감 audit.
    sensitive_fields = {"role", "status", "is_grade_lead"}
    update_payload = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else (body.dict(exclude_unset=True) if hasattr(body, "dict") else {})
    is_sensitive = bool(sensitive_fields & set(update_payload.keys()))
    await log_action(
        db, user, "user_updated",
        target=target.email,
        request=request,
        is_sensitive=is_sensitive,
    )
    return _user_response(target)


@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    mode: str = "disable",
    user: User = Depends(require_permission("user.manage.delete")),
    db: AsyncSession = Depends(get_db),
):
    """계정 삭제 — mode로 강도 선택 (Danger Zone).

    - disable (기본): 소프트 비활성화. 데이터 전부 보존, 로그인만 차단. 복구 가능.
    - delete: 계정 영구 삭제. 개인 데이터(드라이브·제출물·포트폴리오·수강·알림·소유 강좌 등)는
      DB FK CASCADE로 함께 삭제. 공유 공간의 글/댓글은 작성자 표시만 비워진 채 남음.
    - purge: delete + 본인이 올린 글/댓글/공지/업로드 문서/설문응답까지 삭제(완전 삭제).
      단 선배연구(past_researches)·과제·대회 등 기관 콘텐츠는 보존(작성자만 NULL 처리).
    """
    if mode not in ("disable", "delete", "purge"):
        raise HTTPException(400, "mode는 disable|delete|purge 중 하나여야 합니다")

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

    target_email = target.email
    target_name = target.name

    # 모든 모드 공통: 세션 즉시 차단
    from app.modules.permissions.router import _invalidate_user_sessions
    await _invalidate_user_sessions(db, target.id)
    await db.flush()

    if mode == "disable":
        target.status = "disabled"
        await db.flush()
        await log_action(db, user, "user_disabled", target=target_email, request=request, is_sensitive=True)
        return {"ok": True, "mode": mode}

    # delete / purge — 영구 삭제
    from sqlalchemy import text as _text
    if mode == "purge":
        # 본인이 '작성'한 콘텐츠 명시 삭제 (이 FK들은 SET NULL이라 그냥 두면 작성자만 비고 글은 남음).
        # 기관 콘텐츠(과제/대회/문제/동아리/선배연구)는 보존 — 다른 사용자 영향 방지.
        for stmt in (
            "DELETE FROM classroom_post_comments WHERE author_id = :uid",
            "DELETE FROM classroom_posts WHERE author_id = :uid",
            "DELETE FROM announcements WHERE author_id = :uid",
            "DELETE FROM classroom_survey_responses WHERE respondent_id = :uid",
            "DELETE FROM documents WHERE uploaded_by_id = :uid",
        ):
            await db.execute(_text(stmt), {"uid": user_id})

    # 계정 행 삭제 — 개인 데이터는 DB FK CASCADE로 함께 제거됨
    await db.execute(_text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
    db.expunge(target)
    await db.flush()

    await log_action(
        db, user, f"user_{mode}",
        target=f"{target_name}<{target_email}>", request=request, is_sensitive=True,
    )
    return {"ok": True, "mode": mode}
