"""담당교사 매핑 CRUD + CSV 일괄 + 본인 담당 학생."""

import csv
import io as iobuf

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.upload import POLICY_CSV, validate_upload
from app.models.research_supervision import ResearchSupervision
from app.models.user import User
from app.modules.past_research._helpers import active_semester_id
from app.modules.past_research.router import router
from app.modules.past_research.schemas import SupervisionCreate
from app.services.notification import notify_users


@router.get("/_my/supervised-students")
async def my_supervised_students(
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 supervisor인 학생 list (현재 학기)."""
    semester_id = await active_semester_id(db)
    if not semester_id:
        return {"items": [], "semester_id": None}
    rows = (await db.execute(
        select(ResearchSupervision, User).join(
            User, User.id == ResearchSupervision.student_id,
        ).where(
            ResearchSupervision.semester_id == semester_id,
            ResearchSupervision.supervisor_id == user.id,
        )
    )).all()
    return {
        "items": [
            {
                "id": sup.id,
                "student_id": st.id,
                "student_name": st.name,
                "student_username": st.username,
                "grade": st.grade,
                "class_number": getattr(st, "class_number", None),
                "topic_title": sup.topic_title,
                "note": sup.note,
            }
            for sup, st in rows
        ],
        "semester_id": semester_id,
    }


@router.get("/_supervisions")
async def list_supervisions(
    semester_id: int | None = None,
    supervisor_id: int | None = None,
    student_id: int | None = None,
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
):
    q = select(ResearchSupervision)
    conds = []
    if semester_id:
        conds.append(ResearchSupervision.semester_id == semester_id)
    if supervisor_id:
        conds.append(ResearchSupervision.supervisor_id == supervisor_id)
    if student_id:
        conds.append(ResearchSupervision.student_id == student_id)
    if user.role not in ("super_admin", "designated_admin"):
        conds.append(ResearchSupervision.supervisor_id == user.id)
    if conds:
        q = q.where(and_(*conds))
    rows = (await db.execute(q.order_by(ResearchSupervision.id.desc()))).scalars().all()

    user_ids = {r.student_id for r in rows} | {r.supervisor_id for r in rows}
    if user_ids:
        users = {
            u.id: u for u in
            (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        }
    else:
        users = {}

    return {
        "items": [
            {
                "id": r.id,
                "semester_id": r.semester_id,
                "student_id": r.student_id,
                "student_name": users[r.student_id].name if r.student_id in users else None,
                "student_username": users[r.student_id].username if r.student_id in users else None,
                "supervisor_id": r.supervisor_id,
                "supervisor_name": users[r.supervisor_id].name if r.supervisor_id in users else None,
                "topic_title": r.topic_title,
                "note": r.note,
            }
            for r in rows
        ],
    }


@router.post("/_supervisions")
async def create_supervision(
    body: SupervisionCreate,
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """담당교사 매핑 등록 (또는 변경)."""
    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and body.supervisor_id != user.id:
        raise HTTPException(403, "본인을 supervisor로만 등록할 수 있습니다")

    student = (await db.execute(select(User).where(User.id == body.student_id))).scalar_one_or_none()
    if not student or student.role != "student":
        raise HTTPException(400, "유효한 학생 ID가 아닙니다")
    supervisor = (await db.execute(select(User).where(User.id == body.supervisor_id))).scalar_one_or_none()
    if not supervisor or supervisor.role not in ("teacher", "staff", "super_admin", "designated_admin"):
        raise HTTPException(400, "유효한 교사 ID가 아닙니다")

    existing = (await db.execute(
        select(ResearchSupervision).where(
            ResearchSupervision.semester_id == body.semester_id,
            ResearchSupervision.student_id == body.student_id,
        )
    )).scalar_one_or_none()
    if existing:
        if not is_admin and existing.supervisor_id != user.id:
            raise HTTPException(409, "이미 다른 교사가 담당 중입니다 (관리자에게 변경 요청)")
        existing.supervisor_id = body.supervisor_id
        existing.topic_title = body.topic_title
        existing.note = body.note
        await db.flush()
        result_id = existing.id
    else:
        row = ResearchSupervision(
            semester_id=body.semester_id,
            student_id=body.student_id,
            supervisor_id=body.supervisor_id,
            topic_title=body.topic_title,
            note=body.note,
        )
        db.add(row)
        await db.flush()
        result_id = row.id

    await notify_users(
        db, user_ids=[student.id],
        type="research_supervision.assigned",
        title=f"{supervisor.name} 선생님이 연구 담당으로 지정되었습니다",
        body=body.topic_title or None,
        link_url="/s/research-submit",
        source_user_id=user.id,
        meta={"supervisor_id": supervisor.id},
    )

    await log_action(db, user, "research_supervision.assign",
                     f"sem={body.semester_id} student={body.student_id} sup={body.supervisor_id}",
                     request=request)
    return {"id": result_id}


@router.delete("/_supervisions/{sid}")
async def delete_supervision(
    sid: int,
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    row = (await db.execute(
        select(ResearchSupervision).where(ResearchSupervision.id == sid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and row.supervisor_id != user.id:
        raise HTTPException(403)
    await db.delete(row)
    await db.flush()
    await log_action(db, user, "research_supervision.unassign", f"id={sid}", request=request)
    return {"ok": True}


# ── CSV 일괄 ────────────────────────────────────────────────


@router.get("/_supervisions/_csv-template")
async def supervisions_csv_template(
    user: User = Depends(require_permission("past_research.supervise")),
):
    """CSV 템플릿 다운로드. UTF-8 BOM + 한글 헤더 + 예시 + 설명행."""
    body = (
        "﻿"
        "학생아이디,담당교사아이디,연구주제\n"
        "10101,kim.teacher,\n"
        "10102,kim.teacher,예시 주제\n"
        "# 학번(5자리 예 10101) 또는 admin 등록 시 사용한 아이디,# 교사 등록 시 사용한 아이디,# 비워두면 학생이 추후 추가\n"
    )
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="연구담당교사_매핑_템플릿.csv"'},
    )


@router.post("/_supervisions/_bulk-import")
async def supervisions_bulk_import(
    file: UploadFile = File(...),
    semester_id: int = Form(...),
    dry_run: bool = Form(False),
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """CSV로 학생-담당교사 매핑 일괄 등록."""
    data = await validate_upload(file, POLICY_CSV)
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(iobuf.StringIO(text))

    # 한글/영문 헤더 모두 인식
    COLUMN_ALIASES = {
        "학생아이디": "student_username", "학생ID": "student_username", "학번": "student_username",
        "student_username": "student_username",
        "담당교사아이디": "supervisor_username", "교사아이디": "supervisor_username", "supervisor_username": "supervisor_username",
        "연구주제": "topic_title", "주제": "topic_title", "topic_title": "topic_title",
    }

    rows_raw = list(reader)
    # 한글 헤더 → 영문 키 변환 + 주석 행(#) skip
    rows = []
    for r in rows_raw:
        norm = {}
        for k, v in r.items():
            if k is None:
                continue
            norm_k = COLUMN_ALIASES.get(k.strip(), k.strip())
            norm[norm_k] = v
        # 주석 행 skip
        first_val = (norm.get("student_username") or "").strip()
        if first_val.startswith("#"):
            continue
        rows.append(norm)

    MAX_ROWS = 5000
    if len(rows) > MAX_ROWS:
        raise HTTPException(400, f"행 너무 많음 ({len(rows)} > {MAX_ROWS})")

    added = 0
    updated = 0
    failed: list[dict] = []
    is_admin = user.role in ("super_admin", "designated_admin")

    student_usernames = {(r.get("student_username") or "").strip() for r in rows}
    supervisor_usernames = {(r.get("supervisor_username") or "").strip() for r in rows}
    all_usernames = (student_usernames | supervisor_usernames) - {""}

    user_map: dict[str, User] = {}
    if all_usernames:
        found = (await db.execute(
            select(User).where(User.username.in_(all_usernames))
        )).scalars().all()
        user_map = {u.username: u for u in found}

    for idx, row in enumerate(rows, start=2):
        sn = (row.get("student_username") or "").strip()
        sv = (row.get("supervisor_username") or "").strip()
        topic = (row.get("topic_title") or "").strip() or None

        if not sn or not sv:
            failed.append({"row": idx, "reason": "student_username/supervisor_username 누락"})
            continue
        student = user_map.get(sn)
        if not student or student.role != "student":
            failed.append({"row": idx, "reason": f"학생 미존재: {sn}"})
            continue
        supervisor = user_map.get(sv)
        if not supervisor or supervisor.role not in ("teacher", "staff", "super_admin", "designated_admin"):
            failed.append({"row": idx, "reason": f"교사 미존재: {sv}"})
            continue
        if not is_admin and supervisor.id != user.id:
            failed.append({"row": idx, "reason": "본인을 supervisor로만 등록 가능"})
            continue

        existing = (await db.execute(
            select(ResearchSupervision).where(
                ResearchSupervision.semester_id == semester_id,
                ResearchSupervision.student_id == student.id,
            )
        )).scalar_one_or_none()

        if dry_run:
            if existing:
                updated += 1
            else:
                added += 1
            continue

        if existing:
            if not is_admin and existing.supervisor_id != user.id:
                failed.append({"row": idx, "reason": f"이미 다른 교사 담당 (학생: {sn})"})
                continue
            existing.supervisor_id = supervisor.id
            existing.topic_title = topic
            updated += 1
        else:
            db.add(ResearchSupervision(
                semester_id=semester_id,
                student_id=student.id,
                supervisor_id=supervisor.id,
                topic_title=topic,
            ))
            added += 1

    if not dry_run:
        await db.flush()
        await log_action(
            db, user, "research_supervision.bulk_import",
            f"sem={semester_id} added={added} updated={updated} failed={len(failed)}",
            request=request, is_sensitive=True,
        )

    return {
        "added": added,
        "updated": updated,
        "failed": failed,
        "total_rows": len(rows),
        "applied": not dry_run,
    }
