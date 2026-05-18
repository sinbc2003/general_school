"""직책 권한 템플릿 (학기 권한 위임의 근간).

흐름:
1. super_admin/designated_admin이 직책 템플릿 정의 (예 "1학년 담임")
2. 학기 enrollment에 직책 할당 (timetable router의 positions endpoint)
3. resolve_permissions가 현재 학기 enrollment의 직책 → 권한 키 합산
4. 학기 종료 / enrollment 변경 시 자동 회수

router 객체와 헬퍼는 `permissions.router`에서 공유 — endpoint들이 같은 prefix
를 갖고 단일 OpenAPI 그룹에 모임. router.py 끝에서 이 모듈을 import해 등록.
"""

import json

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import verify_2fa_session
from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission_manager
from app.models.permission import Permission
from app.models.position import PositionTemplate, EnrollmentPosition
from app.models.timetable import SemesterEnrollment
from app.models.user import User

# router 객체 + 헬퍼는 router.py에서 import (순환 import 피하기 위해 모듈 import)
from app.modules.permissions.router import (
    router,
    _invalidate_user_sessions,
    _parse_permission_keys,
    _validate_permission_keys,
)


@router.get("/position-templates")
async def list_position_templates(
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """모든 직책 템플릿 목록 (UI에서 카테고리별 그룹)."""
    rows = (await db.execute(
        select(PositionTemplate).order_by(
            PositionTemplate.category, PositionTemplate.display_name
        )
    )).scalars().all()

    # 할당된 enrollment 수 — UI에 "사용 중" 표시용
    usage_rows = (await db.execute(
        select(EnrollmentPosition.position_template_id, EnrollmentPosition.id)
    )).all()
    usage: dict[int, int] = {}
    for tid, _ in usage_rows:
        usage[tid] = usage.get(tid, 0) + 1

    items = []
    for p in rows:
        keys = _parse_permission_keys(p.permission_keys)
        items.append({
            "id": p.id,
            "key": p.key,
            "display_name": p.display_name,
            "description": p.description,
            "category": p.category,
            "is_system": p.is_system,
            "permission_keys": keys,
            "permission_count": len(keys),
            "assignment_count": usage.get(p.id, 0),
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        })
    return {"items": items}


@router.post("/position-templates")
async def create_position_template(
    body: dict,
    request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 생성.
    body: {key, display_name, description?, category?, permission_keys: [str]}
    2FA 필수 (권한 정의는 영향력 큼).
    """
    await verify_2fa_session(user, request, db)
    key = (body.get("key") or "").strip()
    display_name = (body.get("display_name") or "").strip()
    if not key or not display_name:
        raise HTTPException(400, "key, display_name 필수")
    if not key.replace("_", "").replace("-", "").replace(".", "").isalnum():
        raise HTTPException(400, "key는 영문/숫자/_/-/. 만 허용됩니다")

    exists = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.key == key)
    )).scalar_one_or_none()
    if exists:
        raise HTTPException(400, f"이미 존재하는 key: {key}")

    perm_keys = await _validate_permission_keys(
        db, body.get("permission_keys", []), user
    )

    p = PositionTemplate(
        key=key,
        display_name=display_name,
        description=(body.get("description") or None),
        category=(body.get("category") or "기타").strip()[:50],
        permission_keys=json.dumps(perm_keys, ensure_ascii=False),
        is_system=False,  # 시스템 템플릿은 시드/마이그레이션에서만 True
        created_by=user.id,
    )
    db.add(p)
    await db.flush()
    await log_action(
        db, user, "position_template.create",
        target=f"key:{key} perms:{len(perm_keys)}", request=request,
    )
    return {"id": p.id, "key": p.key}


@router.put("/position-templates/{tid}")
async def update_position_template(
    tid: int, body: dict, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 수정 (key는 변경 불가 — enrollment 매핑 안전성). 2FA 필수."""
    await verify_2fa_session(user, request, db)
    p = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)

    if "display_name" in body:
        p.display_name = (body["display_name"] or "").strip()[:200]
    if "description" in body:
        p.description = body["description"] or None
    if "category" in body:
        p.category = (body["category"] or "기타").strip()[:50]
    keys_changed = "permission_keys" in body
    if keys_changed:
        perm_keys = await _validate_permission_keys(db, body["permission_keys"], user)
        p.permission_keys = json.dumps(perm_keys, ensure_ascii=False)

    await db.flush()

    # permission_keys가 바뀌면 이 직책을 부여받은 모든 enrollment의 사용자 세션 무효화
    if keys_changed:
        member_uids = (await db.execute(
            select(SemesterEnrollment.user_id)
            .join(EnrollmentPosition, EnrollmentPosition.enrollment_id == SemesterEnrollment.id)
            .where(EnrollmentPosition.position_template_id == tid)
        )).scalars().all()
        for uid in set(member_uids):
            await _invalidate_user_sessions(db, uid)
        await db.flush()

    await log_action(
        db, user, "position_template.update",
        target=f"id:{tid}", request=request,
    )
    return {"ok": True}


@router.delete("/position-templates/{tid}")
async def delete_position_template(
    tid: int, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿 삭제. 시스템 기본은 삭제 불가. 2FA 필수.

    cascade=CASCADE로 enrollment_positions의 매핑 행도 자동 정리.
    """
    await verify_2fa_session(user, request, db)
    p = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    if p.is_system:
        raise HTTPException(403, "시스템 기본 템플릿은 삭제할 수 없습니다")

    # 삭제 전 영향받을 user_id 수집 (cascade로 EnrollmentPosition 함께 사라짐)
    affected_uids = (await db.execute(
        select(SemesterEnrollment.user_id)
        .join(EnrollmentPosition, EnrollmentPosition.enrollment_id == SemesterEnrollment.id)
        .where(EnrollmentPosition.position_template_id == tid)
    )).scalars().all()

    await db.delete(p)
    await db.flush()

    for uid in set(affected_uids):
        await _invalidate_user_sessions(db, uid)
    await db.flush()

    await log_action(
        db, user, "position_template.delete",
        target=f"id:{tid} key:{p.key} affected:{len(set(affected_uids))}", request=request,
    )
    return {"ok": True}


@router.post("/position-templates/{tid}/apply-to-department")
async def apply_position_template_to_department(
    tid: int, body: dict, request: Request,
    user: User = Depends(require_permission_manager()),
    db: AsyncSession = Depends(get_db),
):
    """직책 템플릿을 특정 학기·부서의 모든 교직원 enrollment에 일괄 할당.

    body: {
      "semester_id": int,
      "department": str,                # SemesterEnrollment.department 매칭값
      "include_roles": ["teacher"|"staff"]?,  # 기본 ["teacher","staff"]
      "replace": bool = false           # True면 대상 enrollment의 기존 직책 통째로 교체
    }

    학년도 단위 운영 시나리오에서 "수학과 전체에 동일 권한" 같은 패턴을 빠르게.
    archived 학기는 차단.
    2FA 필수 (영향 범위 큼).
    """
    from sqlalchemy import delete as sql_delete
    await verify_2fa_session(user, request, db)

    template = (await db.execute(
        select(PositionTemplate).where(PositionTemplate.id == tid)
    )).scalar_one_or_none()
    if not template:
        raise HTTPException(404, "직책 템플릿 없음")

    semester_id = body.get("semester_id")
    department = (body.get("department") or "").strip()
    if not semester_id or not department:
        raise HTTPException(400, "semester_id, department 필수")

    # archived 학기 차단
    from app.models.timetable import Semester
    sem = (await db.execute(
        select(Semester).where(Semester.id == int(semester_id))
    )).scalar_one_or_none()
    if not sem:
        raise HTTPException(404, "학기 없음")
    if sem.is_archived:
        raise HTTPException(423, f"학기 '{sem.name}'은(는) 보관 상태입니다")

    include_roles = body.get("include_roles") or ["teacher", "staff"]
    replace = bool(body.get("replace", False))

    # 대상 enrollment 조회
    target_enrolls = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == int(semester_id),
            SemesterEnrollment.department == department,
            SemesterEnrollment.role.in_(include_roles),
            SemesterEnrollment.status == "active",
        )
    )).scalars().all()

    if not target_enrolls:
        return {
            "ok": True, "applied": 0, "skipped": 0,
            "message": f"부서 '{department}'에 해당하는 active enrollment 없음",
        }

    applied = 0
    skipped = 0
    affected_uids: set[int] = set()
    for e in target_enrolls:
        if replace:
            # 기존 직책 모두 삭제 후 새로 추가
            await db.execute(
                sql_delete(EnrollmentPosition).where(EnrollmentPosition.enrollment_id == e.id)
            )
            db.add(EnrollmentPosition(
                enrollment_id=e.id, position_template_id=tid, granted_by=user.id,
            ))
            applied += 1
            affected_uids.add(e.user_id)
        else:
            # 이미 이 직책이 할당된 enrollment는 skip
            already = (await db.execute(
                select(EnrollmentPosition).where(
                    EnrollmentPosition.enrollment_id == e.id,
                    EnrollmentPosition.position_template_id == tid,
                )
            )).scalar_one_or_none()
            if already:
                skipped += 1
                continue
            db.add(EnrollmentPosition(
                enrollment_id=e.id, position_template_id=tid, granted_by=user.id,
            ))
            applied += 1
            affected_uids.add(e.user_id)

    await db.flush()

    # 영향받은 사용자 세션 무효화
    for uid in affected_uids:
        await _invalidate_user_sessions(db, uid)
    await db.flush()

    await log_action(
        db, user, "position_template.apply_to_department",
        target=f"tid:{tid} sem:{semester_id} dept:{department} applied:{applied} replace:{replace}",
        request=request, is_sensitive=True,
    )
    return {
        "ok": True,
        "applied": applied,
        "skipped": skipped,
        "affected_users": len(affected_uids),
    }
