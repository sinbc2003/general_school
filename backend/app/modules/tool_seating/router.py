"""자리배치 (seating arrangement) 라우터 — 교사 전용 수업 도구.

엔드포인트 (tools.seating.host — 교사·직원):
  GET    /api/tools/seating               본인 자리표 list (휴지통 제외)
  POST   /api/tools/seating               자리표 생성
  GET    /api/tools/seating/_homeroom     담임 학급 명단 (현재 학기) — 명단 가져오기용
  GET    /api/tools/seating/{id}          상세
  PUT    /api/tools/seating/{id}          수정 (제목/배치/명단/조건/자리)
  DELETE /api/tools/seating/{id}          드라이브 휴지통 이동 (soft delete)
  POST   /api/tools/seating/{id}/shuffle  제약 충족 랜덤 배치 (+ 옵션 저장)

교과(강좌) 명단은 프런트가 기존 /api/classroom/courses[/{cid}]를 재사용한다.
배치 제약은 교사 전용 — 학생에게 노출되지 않는다(학생용 페이지 없음).

⚠️ 라우트 순서: "/_homeroom" literal을 "/{id}"보다 먼저 등록
(FastAPI path param은 [^/]+ — 뒤 등록 literal은 안 먹힘).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import is_admin, require_permission
from app.core.semester import get_active_semester_id_or_404
from app.models import SeatingChart, User
from app.models.timetable import SemesterEnrollment
from app.modules.tool_seating.schemas import (
    SeatingCreate, SeatingUpdate, ShuffleReq,
)
from app.services.seating_solver import solve_seating

router = APIRouter(prefix="/api/tools/seating", tags=["tool-seating"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_or_404(db: AsyncSession, cid: int) -> SeatingChart:
    c = await db.get(SeatingChart, cid)
    if not c or c.deleted_at is not None:
        raise HTTPException(404, "자리표를 찾을 수 없습니다")
    return c


def _assert_owner(c: SeatingChart, user: User) -> None:
    if c.owner_id != user.id and not is_admin(user):
        raise HTTPException(403, "본인이 만든 자리표만 사용할 수 있습니다")


def _dict(c: SeatingChart, *, full: bool = False) -> dict:
    """list는 메타만, full=True면 layout/roster/constraints/assignment 포함."""
    base = {
        "id": c.id,
        "title": c.title,
        "description": c.description,
        "roster_count": len(c.roster or []),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
    if full:
        base.update({
            "layout": c.layout or {},
            "roster": c.roster or [],
            "constraints": c.constraints or {},
            "assignment": c.assignment or {},
        })
    return base


# ─────────────────────────────────────────────────────────────────────────────
# list / create
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
async def my_charts(
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(SeatingChart).where(
            SeatingChart.owner_id == user.id,
            SeatingChart.deleted_at.is_(None),
        ).order_by(SeatingChart.updated_at.desc()).limit(200)
    )).scalars().all()
    return {"items": [_dict(c) for c in rows]}


@router.post("")
async def create_chart(
    body: SeatingCreate, request: Request,
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    c = SeatingChart(
        owner_id=user.id,
        title=body.title.strip(),
        description=(body.description or "").strip() or None,
        layout=body.layout.model_dump() if body.layout else None,
        roster=[r.model_dump() for r in body.roster] if body.roster is not None else None,
        constraints=body.constraints.model_dump() if body.constraints else None,
        assignment=body.assignment if body.assignment is not None else None,
    )
    db.add(c)
    await db.flush()
    await db.refresh(c)
    await log_action(db, user, "tools.seating.create", target=f"seating:{c.id}", request=request)
    return _dict(c, full=True)


# ─────────────────────────────────────────────────────────────────────────────
# 담임 학급 명단 (literal — /{id}보다 먼저)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/_homeroom")
async def homeroom_roster(
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    """현재 학기 내 담임 학급 학생 명단. 담임이 아니면 students=[] + label=None."""
    try:
        semester_id = await get_active_semester_id_or_404(db)
    except HTTPException:
        return {"label": None, "students": []}

    my_enroll = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == semester_id,
            SemesterEnrollment.user_id == user.id,
        )
    )).scalar_one_or_none()
    homeroom = ((my_enroll.homeroom_class if my_enroll else None) or "").strip()
    if not homeroom:
        return {"label": None, "students": []}
    try:
        g, c = homeroom.split("-", 1)
        grade, class_number = int(g), int(c)
    except (ValueError, IndexError):
        return {"label": None, "students": []}

    rows = (await db.execute(
        select(
            User.id, User.name,
            SemesterEnrollment.student_number,
            SemesterEnrollment.grade,
            SemesterEnrollment.class_number,
        )
        .join(SemesterEnrollment, SemesterEnrollment.user_id == User.id)
        .where(
            SemesterEnrollment.semester_id == semester_id,
            SemesterEnrollment.role == "student",
            SemesterEnrollment.status == "active",
            SemesterEnrollment.grade == grade,
            SemesterEnrollment.class_number == class_number,
        )
        .order_by(SemesterEnrollment.student_number.asc().nulls_last(), User.name.asc())
    )).all()

    students = []
    for uid, name, snum, grd, cls in rows:
        number = (snum % 100) if isinstance(snum, int) else None
        students.append({
            "user_id": uid, "name": name, "student_number": snum,
            "number": number, "grade": grd, "class_number": cls,
        })
    return {"label": f"{grade}학년 {class_number}반", "students": students}


# ─────────────────────────────────────────────────────────────────────────────
# detail / update / delete / shuffle
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{cid}")
async def get_chart(
    cid: int,
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    c = await _get_or_404(db, cid)
    _assert_owner(c, user)
    return _dict(c, full=True)


@router.put("/{cid}")
async def update_chart(
    cid: int, body: SeatingUpdate, request: Request,
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    c = await _get_or_404(db, cid)
    _assert_owner(c, user)
    if body.title is not None:
        c.title = body.title.strip()
    if body.description is not None:
        c.description = body.description.strip() or None
    if body.layout is not None:
        c.layout = body.layout.model_dump()
    if body.roster is not None:
        c.roster = [r.model_dump() for r in body.roster]
    if body.constraints is not None:
        c.constraints = body.constraints.model_dump()
    if body.assignment is not None:
        c.assignment = body.assignment
    await db.flush()
    await db.refresh(c)
    await log_action(db, user, "tools.seating.update", target=f"seating:{cid}", request=request)
    return _dict(c, full=True)


@router.delete("/{cid}")
async def delete_chart(
    cid: int, request: Request,
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    """드라이브 휴지통 이동 (30일 후 자동 영구 삭제 — drive cron)."""
    c = await _get_or_404(db, cid)
    _assert_owner(c, user)
    c.deleted_at = _now()
    c.deleted_by = user.id
    await db.flush()
    await log_action(db, user, "tools.seating.trash", target=f"seating:{cid}", request=request)
    return {"ok": True}


@router.post("/{cid}/shuffle")
async def shuffle_chart(
    cid: int, body: ShuffleReq, request: Request,
    user: User = Depends(require_permission("tools.seating.host")),
    db: AsyncSession = Depends(get_db),
):
    """제약(인접 금지·짝·혼자·고정)을 지키며 랜덤 배치. save=True면 즉시 저장."""
    c = await _get_or_404(db, cid)
    _assert_owner(c, user)

    layout = c.layout or {}
    if not (layout.get("desks") or []):
        raise HTTPException(400, "교실 배치를 먼저 만드세요 (책상이 없습니다)")
    roster = c.roster or []
    roster_keys = [str(r.get("key")) for r in roster if isinstance(r, dict) and r.get("key")]
    if not roster_keys:
        raise HTTPException(400, "명단을 먼저 추가하세요")

    constraints = dict(c.constraints or {})
    if not body.keep_fixed:
        constraints = {**constraints, "fixed": {}}

    result = solve_seating(
        layout, roster_keys, constraints, seed=body.seed,
    )

    if body.save:
        c.assignment = result["assignment"]
        await db.flush()
        await db.refresh(c)
        await log_action(
            db, user, "tools.seating.shuffle",
            target=f"seating:{cid} satisfied:{result['satisfied']}", request=request,
        )
    return result
