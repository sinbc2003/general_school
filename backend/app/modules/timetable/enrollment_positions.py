"""학기 enrollment의 직책 권한 위임 (PositionTemplate ↔ Enrollment 매핑).

enrollment 한 줄에 PositionTemplate 여러 개 할당 가능 — "3학년 담임" + "동아리
담당교사" + "정보 부장". resolve_permissions가 현재 학기의 enrollment의 직책 →
권한을 자동 합산. 학기 종료 시 새 학기의 enrollment는 빈 상태로 시작 → 자동 회수.

router 객체는 router.py에서 공유. router.py 끝의 'from . import enrollment_positions'로 등록.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import get_semester_by_id_or_404
from app.models.timetable import Semester, SemesterEnrollment
from app.models.user import User
from app.modules.timetable.schemas import EnrollmentPositionsSet

from app.modules.timetable.router import router, _assert_semester_writable


@router.get("/semesters/{sid}/enrollments/{eid}/positions")
async def list_enrollment_positions(
    sid: int, eid: int,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment에 할당된 직책 + 그 직책이 부여하는 권한 키 미리보기."""
    from app.models.position import PositionTemplate, EnrollmentPosition
    import json as _json

    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "enrollment 없음")

    rows = (await db.execute(
        select(EnrollmentPosition, PositionTemplate)
        .join(PositionTemplate, PositionTemplate.id == EnrollmentPosition.position_template_id)
        .where(EnrollmentPosition.enrollment_id == eid)
        .order_by(PositionTemplate.category, PositionTemplate.display_name)
    )).all()

    items = []
    for ep, pt in rows:
        try:
            perm_keys = _json.loads(pt.permission_keys or "[]")
        except (_json.JSONDecodeError, TypeError):
            perm_keys = []
        items.append({
            "id": ep.id,
            "template_id": pt.id,
            "template_key": pt.key,
            "display_name": pt.display_name,
            "category": pt.category,
            "permission_count": len(perm_keys),
            "note": ep.note,
        })
    return {"items": items}


@router.put("/semesters/{sid}/enrollments/{eid}/positions")
async def set_enrollment_positions(
    sid: int, eid: int, body: EnrollmentPositionsSet, request: Request,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment의 직책 목록을 통째로 교체 (PUT 의미).
    비우면 모든 직책 해제.
    """
    from app.models.position import PositionTemplate, EnrollmentPosition
    from sqlalchemy import delete as sql_delete

    await _assert_semester_writable(db, sid)
    e = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "enrollment 없음")

    template_ids = sorted(set(body.template_ids))

    if template_ids:
        valid_ids = set((await db.execute(
            select(PositionTemplate.id).where(PositionTemplate.id.in_(template_ids))
        )).scalars().all())
        invalid = [t for t in template_ids if t not in valid_ids]
        if invalid:
            raise HTTPException(400, f"존재하지 않는 template_id: {invalid}")

    # 기존 매핑 일괄 삭제 후 새로 추가 (PUT 의미)
    await db.execute(
        sql_delete(EnrollmentPosition).where(EnrollmentPosition.enrollment_id == eid)
    )
    for tid in template_ids:
        db.add(EnrollmentPosition(
            enrollment_id=eid,
            position_template_id=tid,
            granted_by=user.id,
        ))
    await db.flush()

    # 대상 사용자의 세션 무효화 → stale 권한 차단
    from app.modules.permissions.router import _invalidate_user_sessions
    await _invalidate_user_sessions(db, e.user_id)
    await db.flush()

    await log_action(
        db, user, "enrollment_position.set",
        target=f"enroll:{eid} templates:{template_ids}", request=request,
    )
    return {"ok": True, "count": len(template_ids)}


@router.post("/semesters/{sid}/enrollments/{eid}/positions/sync-year")
async def sync_enrollment_positions_to_year(
    sid: int, eid: int, body: EnrollmentPositionsSet, request: Request,
    user: User = Depends(require_permission("system.enrollment.manage")),
    db: AsyncSession = Depends(get_db),
):
    """이 enrollment의 직책을 **같은 학년도의 다른 학기**에 동기화.

    운영 시나리오: 업무분장은 학년도 단위 → 1학기에 직책 바꾸면 2학기에도 적용.
    같은 user_id가 다른 학기에 active enrollment를 가지면 동일 template_ids로 PUT.
    """
    from app.models.position import PositionTemplate, EnrollmentPosition
    from sqlalchemy import delete as sql_delete

    await _assert_semester_writable(db, sid)
    src = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.id == eid,
            SemesterEnrollment.semester_id == sid,
        )
    )).scalar_one_or_none()
    if not src:
        raise HTTPException(404, "enrollment 없음")

    src_semester = await get_semester_by_id_or_404(db, sid)
    template_ids = sorted(set(body.template_ids))

    if template_ids:
        valid_ids = set((await db.execute(
            select(PositionTemplate.id).where(PositionTemplate.id.in_(template_ids))
        )).scalars().all())
        invalid = [t for t in template_ids if t not in valid_ids]
        if invalid:
            raise HTTPException(400, f"존재하지 않는 template_id: {invalid}")

    # 같은 학년도(year) 다른 학기의 같은 user enrollment (자기 자신 포함)
    targets = (await db.execute(
        select(SemesterEnrollment, Semester)
        .join(Semester, Semester.id == SemesterEnrollment.semester_id)
        .where(
            SemesterEnrollment.user_id == src.user_id,
            SemesterEnrollment.status == "active",
            Semester.year == src_semester.year,
        )
    )).all()

    synced: list[int] = []
    skipped: list[int] = []
    for target_enroll, target_sem in targets:
        if target_enroll.status != "active":
            skipped.append(target_sem.id)
            continue
        await db.execute(
            sql_delete(EnrollmentPosition).where(
                EnrollmentPosition.enrollment_id == target_enroll.id,
            )
        )
        for tid in template_ids:
            db.add(EnrollmentPosition(
                enrollment_id=target_enroll.id,
                position_template_id=tid,
                granted_by=user.id,
            ))
        synced.append(target_enroll.id)

    await db.flush()

    # 대상 사용자(같은 사용자의 학년도 전체 enrollment) 세션 무효화
    if synced:
        from app.modules.permissions.router import _invalidate_user_sessions
        await _invalidate_user_sessions(db, src.user_id)
        await db.flush()

    await log_action(
        db, user, "enrollment_position.sync_year",
        target=f"year:{src_semester.year} user:{src.user_id} count:{len(synced)}",
        request=request,
    )
    return {"ok": True, "synced_enrollments": synced, "skipped_semesters": skipped}
