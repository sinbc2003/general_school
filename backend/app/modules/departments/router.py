"""부서 CRUD — super_admin/designated_admin 관리.

엔드포인트:
  GET    /api/departments              — 목록 (lead_user 정보 포함)
  POST   /api/departments              — 신규
  PUT    /api/departments/{id}         — 수정
  DELETE /api/departments/{id}         — 삭제 (사용자 department_id는 NULL SET)
  POST   /api/departments/_bulk        — 일괄 등록 (온보딩 마법사용)
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models import Department, User
from app.modules.departments.schemas import (
    DepartmentBulkCreate, DepartmentCreate, DepartmentUpdate,
)


router = APIRouter(prefix="/api/departments", tags=["departments"])


def _serialize_with_map(d: Department, leads_map: dict[int, User]) -> dict:
    """leads_map에서 dict lookup으로 lead 정보 채움 (N+1 회피)."""
    lead = leads_map.get(d.lead_user_id) if d.lead_user_id else None
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "lead_user_id": d.lead_user_id,
        "lead_name": lead.name if lead else None,
        "lead_email": lead.email if lead else None,
        "sort_order": d.sort_order,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


async def _serialize(db: AsyncSession, d: Department) -> dict:
    """단일 객체 직렬화 (create/update에서 사용)."""
    leads_map: dict[int, User] = {}
    if d.lead_user_id:
        lead = await db.get(User, d.lead_user_id)
        if lead:
            leads_map[d.lead_user_id] = lead
    return _serialize_with_map(d, leads_map)


@router.get("")
async def list_departments(
    user: User = Depends(require_permission("department.view")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Department).order_by(Department.sort_order, Department.name)
        )
    ).scalars().all()
    # N+1 회피: lead_user_id 모두 한 번에 batch fetch
    lead_ids = {d.lead_user_id for d in rows if d.lead_user_id}
    leads_map: dict[int, User] = {}
    if lead_ids:
        urows = (await db.execute(
            select(User).where(User.id.in_(lead_ids))
        )).scalars().all()
        leads_map = {u.id: u for u in urows}
    items = [_serialize_with_map(d, leads_map) for d in rows]
    return {"items": items}


@router.post("")
async def create_department(
    body: DepartmentCreate,
    request: Request,
    user: User = Depends(require_permission("department.manage")),
    db: AsyncSession = Depends(get_db),
):
    # 중복 이름 차단
    dup = (await db.execute(
        select(Department).where(Department.name == body.name)
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, f"이미 등록된 부서: {body.name}")

    d = Department(
        name=body.name,
        description=body.description,
        lead_user_id=body.lead_user_id,
        sort_order=body.sort_order or 0,
    )
    db.add(d)
    await db.flush()
    await log_action(
        db, user, "department_created",
        target=str(d.id), detail=f"name={d.name}", request=request,
    )
    return await _serialize(db, d)


@router.put("/{dept_id}")
async def update_department(
    dept_id: int,
    body: DepartmentUpdate,
    request: Request,
    user: User = Depends(require_permission("department.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Department, dept_id)
    if not d:
        raise HTTPException(404, "부서를 찾을 수 없습니다")

    if body.name is not None and body.name != d.name:
        dup = (await db.execute(
            select(Department).where(
                Department.name == body.name, Department.id != dept_id,
            )
        )).scalar_one_or_none()
        if dup:
            raise HTTPException(409, f"이미 등록된 부서명: {body.name}")
        d.name = body.name
    if body.description is not None:
        d.description = body.description
    if body.lead_user_id is not None:
        # 0 또는 음수는 NULL 의미로 해석
        d.lead_user_id = body.lead_user_id if body.lead_user_id > 0 else None
    if body.sort_order is not None:
        d.sort_order = body.sort_order
    await db.flush()
    await log_action(
        db, user, "department_updated",
        target=str(d.id), detail=f"name={d.name}", request=request,
    )
    return await _serialize(db, d)


@router.delete("/{dept_id}")
async def delete_department(
    dept_id: int,
    request: Request,
    user: User = Depends(require_permission("department.manage")),
    db: AsyncSession = Depends(get_db),
):
    d = await db.get(Department, dept_id)
    if not d:
        raise HTTPException(404, "부서를 찾을 수 없습니다")
    name = d.name
    # FK ondelete=SET NULL로 User.department_id 자동 NULL 처리
    await db.delete(d)
    await db.flush()
    await log_action(
        db, user, "department_deleted",
        target=str(dept_id), detail=f"name={name}", request=request,
    )
    return {"ok": True}


@router.post("/_bulk")
async def bulk_create_departments(
    body: DepartmentBulkCreate,
    request: Request,
    user: User = Depends(require_permission("department.manage")),
    db: AsyncSession = Depends(get_db),
):
    """온보딩 마법사 일괄 등록. 이미 있는 이름은 skip (멱등)."""
    existing_names = set(
        (await db.execute(select(Department.name))).scalars().all()
    )
    created = 0
    skipped = 0
    for i, dep in enumerate(body.departments):
        if dep.name in existing_names:
            skipped += 1
            continue
        d = Department(
            name=dep.name,
            description=dep.description,
            lead_user_id=dep.lead_user_id,
            sort_order=dep.sort_order if dep.sort_order else i,
        )
        db.add(d)
        existing_names.add(dep.name)
        created += 1
    await db.flush()
    await log_action(
        db, user, "department_bulk_create",
        detail=f"created={created} skipped={skipped}", request=request,
    )
    return {"ok": True, "created": created, "skipped": skipped}

from app.modules.departments import delegation  # noqa: E402, F401
