"""동아리 라우터 — 동아리, 활동, 제출"""

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select, desc, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.semester import (
    get_active_semester_id_or_404,
    resolve_semester_id,
    get_semester_by_id_or_404,
)
from app.models.club import Club, ClubActivity, ClubSubmission
from app.models.user import User
from app.modules.club.schemas import (
    ClubCreate, ClubUpdate, ClubActivityCreate, ClubSubmissionCreate,
)

router = APIRouter(prefix="/api/club", tags=["club"])


@router.post("")
async def create_club(
    body: ClubCreate,
    user: User = Depends(require_permission("club.manage.create")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    sid = await resolve_semester_id({"semester_id": body.semester_id} if body.semester_id else None, db)
    sem = await get_semester_by_id_or_404(db, sid)
    c = Club(
        semester_id=sid,
        name=body.name, description=body.description,
        advisor_id=body.advisor_id, members=body.members,
        year=body.year or sem.year, budget=body.budget,
    )
    db.add(c)
    await db.flush()
    await log_action(db, user, "club.create", f"club:{c.id}", request=request)
    return {"id": c.id, "name": c.name, "semester_id": sid}


@router.get("")
async def list_clubs(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    year: int | None = None,
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    sid = semester_id or await get_active_semester_id_or_404(db)
    q = select(Club).where(Club.semester_id == sid)
    cq = select(func.count(Club.id)).where(Club.semester_id == sid)
    if year:
        q = q.where(Club.year == year)
        cq = cq.where(Club.year == year)
    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(desc(Club.created_at))
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return {
        "items": [{
            "id": c.id, "name": c.name, "year": c.year,
            "status": c.status, "members": c.members,
        } for c in rows],
        "total": total, "page": page, "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


@router.get("/{cid}")
async def get_club(
    cid: int,
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    c = (await db.execute(select(Club).where(Club.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404, "동아리를 찾을 수 없습니다")
    return {
        "id": c.id, "name": c.name, "description": c.description,
        "year": c.year, "status": c.status, "members": c.members,
        "budget": c.budget,
    }


@router.put("/{cid}")
async def update_club(
    cid: int, body: ClubUpdate,
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    c = (await db.execute(select(Club).where(Club.id == cid))).scalar_one_or_none()
    if not c:
        raise HTTPException(404)
    data = body.model_dump(exclude_unset=True)
    for f, v in data.items():
        setattr(c, f, v)
    await db.flush()
    await log_action(db, user, "club.update", f"club:{cid}", request=request)
    return {"ok": True}


# ── Activities ──

@router.post("/{cid}/activities")
async def create_activity(
    cid: int, body: ClubActivityCreate,
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    a = ClubActivity(
        club_id=cid, title=body.title, content=body.content,
        activity_date=body.activity_date,
        attendees=body.attendees, created_by_id=user.id,
    )
    db.add(a)
    await db.flush()
    return {"id": a.id}


@router.get("/{cid}/activities")
async def list_activities(
    cid: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    """동아리 활동 목록 (페이지네이션). 기본 50, 최대 500."""
    rows = (await db.execute(
        select(ClubActivity).where(ClubActivity.club_id == cid)
        .order_by(desc(ClubActivity.activity_date))
        .offset(offset).limit(limit)
    )).scalars().all()
    return {
        "limit": limit, "offset": offset,
        "items": [{
            "id": a.id, "title": a.title, "content": a.content,
            "activity_date": a.activity_date.isoformat() if a.activity_date else None,
            "attendees": a.attendees,
        } for a in rows],
    }


# ── Submissions (학생) ──

@router.post("/{cid}/submissions")
async def create_submission(
    cid: int, body: ClubSubmissionCreate,
    user: User = Depends(require_permission("club.submission.upload")),
    db: AsyncSession = Depends(get_db),
):
    s = ClubSubmission(
        club_id=cid, author_id=user.id,
        title=body.title, submission_type=body.submission_type,
        file_path=body.file_path,
    )
    db.add(s)
    await db.flush()
    return {"id": s.id}


@router.get("/{cid}/submissions")
async def list_submissions(
    cid: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_permission("club.activity.write")),
    db: AsyncSession = Depends(get_db),
):
    """동아리 산출물 목록 (페이지네이션). 기본 50, 최대 500."""
    rows = (await db.execute(
        select(ClubSubmission, User.name)
        .join(User, User.id == ClubSubmission.author_id)
        .where(ClubSubmission.club_id == cid)
        .order_by(desc(ClubSubmission.created_at))
        .offset(offset).limit(limit)
    )).all()
    return {
        "limit": limit, "offset": offset,
        "items": [{
            "id": s[0].id, "author_id": s[0].author_id, "name": s[1],
            "title": s[0].title, "submission_type": s[0].submission_type,
            "created_at": s[0].created_at.isoformat() if s[0].created_at else None,
        } for s in rows],
    }


# ── 학생 동아리 일괄 배정 (CSV import) ─────────────────────────────────
# 컬럼: student_number, name, club_name
# - 한 학생이 여러 동아리에 동시 가입 가능 (여러 행)
# - 학기 단위 (현재 학기 또는 지정 학기). 같은 학기 내 동아리만 매칭.
# - 학생 매칭 우선순위: student_number > name (학번 있으면 학번 사용)
# - dry_run=true면 검증만, false면 실제 적용.

@router.get("/_assignments/csv-template")
async def assignment_csv_template(
    user: User = Depends(require_permission("club.manage.edit")),
):
    """동아리 일괄 배정용 CSV 템플릿 (UTF-8 with BOM, Excel 한글 호환)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["student_number", "name", "club_name"])
    w.writerow(["1001", "홍길동", "수학 동아리"])
    w.writerow(["1002", "김철수", "과학 탐구반"])
    data = "﻿" + buf.getvalue()
    return Response(
        content=data.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="club_assignments_template.csv"'},
    )


@router.post("/_assignments/import")
async def assignment_csv_import(
    file: UploadFile = File(...),
    semester_id: int | None = Query(None, description="미지정 시 현재 학기"),
    dry_run: bool = Query(True, description="true면 검증만, false면 실제 적용"),
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학번/이름/동아리명 CSV로 학생을 동아리에 일괄 배정.

    한 학생을 여러 동아리에 가입시키려면 행을 여러 줄 작성.
    같은 동아리에 이미 가입된 학생이면 skip (멱등).
    """
    from app.core.upload import POLICY_CSV, validate_upload

    sid = await resolve_semester_id({"semester_id": semester_id} if semester_id else None, db)

    # CSV 검증 (확장자·크기 화이트리스트) 후 BOM 제거
    raw_bytes = await validate_upload(file, POLICY_CSV)
    raw = raw_bytes.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    rows: list[dict] = []
    for r in reader:
        rows.append({k.strip().lower(): (v or "").strip() for k, v in r.items() if k})

    # 학기 내 동아리 + 학생 모두 미리 로딩 (N+1 회피)
    clubs = (await db.execute(select(Club).where(Club.semester_id == sid))).scalars().all()
    club_by_name: dict[str, Club] = {c.name.strip(): c for c in clubs}

    students = (await db.execute(
        select(User).where(User.role == "student")
    )).scalars().all()
    by_student_number: dict[str, User] = {}
    by_name: dict[str, list[User]] = {}
    for u in students:
        if u.student_number is not None:
            by_student_number[str(u.student_number)] = u
        by_name.setdefault(u.name, []).append(u)

    added = 0
    skipped_already_member = 0
    errors: list[dict] = []
    # 동아리별 누적 멤버 ID set (CSV 내 중복 행도 동일 동아리에 한 번만 추가)
    pending: dict[int, set[int]] = {}  # club_id -> {user_id, ...}

    for idx, r in enumerate(rows, start=2):  # header는 1행
        student_number = r.get("student_number", "")
        name = r.get("name", "")
        club_name = r.get("club_name", "")
        if not club_name:
            errors.append({"row": idx, "error": "club_name 비어있음"})
            continue
        # 학생 매칭
        u = None
        if student_number and student_number in by_student_number:
            u = by_student_number[student_number]
        elif name:
            candidates = by_name.get(name, [])
            if len(candidates) == 1:
                u = candidates[0]
            elif len(candidates) > 1:
                errors.append({"row": idx, "error": f"동명이인 {len(candidates)}명 — student_number 필요"})
                continue
        if not u:
            errors.append({"row": idx, "error": f"학생 미발견 (number={student_number}, name={name})"})
            continue

        # 동아리 매칭
        club = club_by_name.get(club_name.strip())
        if not club:
            errors.append({"row": idx, "error": f"동아리 미발견: {club_name}"})
            continue

        # 기존 members 정규화
        if club.id not in pending:
            existing_ids = set()
            for m in (club.members or []):
                if isinstance(m, dict) and "user_id" in m:
                    existing_ids.add(m["user_id"])
                elif isinstance(m, int):
                    existing_ids.add(m)
            pending[club.id] = existing_ids

        if u.id in pending[club.id]:
            skipped_already_member += 1
            continue

        pending[club.id].add(u.id)
        added += 1

    if not dry_run and added > 0:
        for club_id, ids in pending.items():
            club = next((c for c in clubs if c.id == club_id), None)
            if not club:
                continue
            club.members = [{"user_id": uid} for uid in sorted(ids)]
        await db.flush()
        await log_action(
            db, user, "club.assignments.import",
            f"semester:{sid} added={added}",
            request=request,
        )

    return {
        "semester_id": sid,
        "added": added,
        "skipped_already_member": skipped_already_member,
        "errors": errors,
        "total_rows": len(rows),
        "applied": (not dry_run) and added > 0,
    }


# ── 산출물 승인 흐름 (advisor 승인 시 StudentArtifact 자동 생성) ──


@router.patch("/submissions/{sid}/_review")
async def review_club_submission(
    sid: int,
    status: str = Query(..., pattern="^(approved|rejected)$"),
    rejection_reason: str | None = Query(None, max_length=500),
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """동아리 산출물 승인/거부.

    advisor 본인이거나 admin만 가능. 승인 시 StudentArtifact 자동 등록.
    """
    from datetime import datetime, timezone
    from app.services.notification import notify_users
    from app.services.student_artifact_sync import ensure_student_artifact

    sub = await db.get(ClubSubmission, sid)
    if not sub:
        raise HTTPException(404)
    if sub.status != "pending":
        raise HTTPException(409, f"이미 처리됨 (status={sub.status})")

    club = await db.get(Club, sub.club_id)
    if not club:
        raise HTTPException(404)
    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and club.advisor_id != user.id:
        raise HTTPException(403, "동아리 advisor만 승인할 수 있습니다")

    sub.status = status
    sub.reviewed_by_id = user.id
    sub.reviewed_at = datetime.now(timezone.utc)
    sub.rejection_reason = rejection_reason if status == "rejected" else None

    if status == "approved":
        artifact_id = await ensure_student_artifact(
            db,
            student_id=sub.author_id,
            title=sub.title,
            description=f"{club.name} 동아리 산출물",
            category=sub.submission_type or "report",
            file_url=sub.file_path,
            file_name=sub.title,
            file_size=None,
            tags=[club.name],
            existing_id=sub.student_artifact_id,
        )
        if artifact_id:
            sub.student_artifact_id = artifact_id

    await db.flush()

    if status == "approved":
        await notify_users(
            db, user_ids=[sub.author_id],
            type="club_submission.approved",
            title=f"{club.name} 동아리 산출물이 승인되었습니다",
            body=sub.title,
            link_url="/s/my-portfolio",
            source_user_id=user.id,
            meta={"club_id": club.id, "submission_id": sub.id},
        )
    else:
        await notify_users(
            db, user_ids=[sub.author_id],
            type="club_submission.rejected",
            title=f"{club.name} 동아리 산출물이 반려되었습니다",
            body=rejection_reason or "사유 미기재",
            link_url=f"/s/club",
            source_user_id=user.id,
            meta={"club_id": club.id, "submission_id": sub.id, "reason": rejection_reason},
        )

    await log_action(
        db, user, f"club_submission.{status}", f"id={sid}",
        request=request, is_sensitive=True,
    )
    return {"ok": True, "status": sub.status}


@router.get("/_my/pending-submissions")
async def my_pending_club_submissions(
    user: User = Depends(require_permission("club.manage.edit")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 advisor인 동아리의 pending 산출물."""
    rows = (await db.execute(
        select(ClubSubmission, User, Club).join(
            User, User.id == ClubSubmission.author_id,
        ).join(
            Club, Club.id == ClubSubmission.club_id,
        ).where(
            ClubSubmission.status == "pending",
            Club.advisor_id == user.id,
        ).order_by(desc(ClubSubmission.created_at))
    )).all()
    return {
        "items": [
            {
                "id": s.id, "club_id": s.club_id, "club_name": c.name,
                "author_id": s.author_id, "author_name": u.name, "author_username": u.username,
                "title": s.title, "submission_type": s.submission_type,
                "file_path": s.file_path,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, u, c in rows
        ],
    }
