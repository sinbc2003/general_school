"""과거 학생 연구 보고서 아카이브 + 학생 자가 업로드/교사 승인 라우터.

흐름:
- 관리자: ZIP 일괄 업로드 (파일명 자동 파싱, status=approved 즉시) + 삭제
- 학생: /api/past-research/_submit 으로 본인 보고서 업로드 (status=pending)
- 담당교사: /api/past-research/{rid}/_review 로 승인/거부
- 모든 인증 사용자: 검색·조회·다운로드 (status='approved'만, admin은 전체 옵션)
- 다운로드: files/_guard_past_research (인증)
"""

import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import String as SaString
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.database import get_db
from app.core.files import ensure_dir_async, write_bytes_async
from app.core.permissions import require_permission
from app.core.upload import (
    POLICY_DOCUMENT,
    POLICY_PAST_RESEARCH_ZIP,
    validate_upload,
)
from app.models.past_research import PastResearch
from app.models.research_supervision import ResearchSupervision
from app.models.timetable import Semester
from app.models.user import User
from app.modules.past_research.parser import make_standard_filename, parse_filename
from app.modules.past_research.schemas import (
    ReviewReq,
    StudentSubmitMeta,
    SupervisionCreate,
)
from app.services.notification import notify_users
from app.services.student_artifact_sync import ensure_student_artifact

router = APIRouter(prefix="/api/past-research", tags=["past-research"])

UPLOAD_DIR = os.path.join("storage", "past_research")
MAX_PDFS_PER_ZIP = 2000
MAX_PDF_SIZE = 50 * 1024 * 1024  # 50MB per PDF


def _to_item(p: PastResearch, submitter_name: str | None = None) -> dict:
    return {
        "id": p.id,
        "year": p.year,
        "grade": p.grade,
        "semester": p.semester,
        "report_type": p.report_type,
        "fields": list(p.fields or []),
        "title": p.title,
        "is_excellent": p.is_excellent,
        "original_filename": p.original_filename,
        "file_size": p.file_size,
        "file_url": "/" + p.stored_path.replace("\\", "/"),
        "status": p.status,
        "submitted_by_student_id": p.submitted_by_student_id,
        "submitted_by_name": submitter_name,
        "supervisor_id": p.supervisor_id,
        "rejection_reason": p.rejection_reason,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


async def _active_semester_id(db: AsyncSession) -> int | None:
    sem = (await db.execute(
        select(Semester).where(Semester.is_current == True).order_by(Semester.id.desc())
    )).scalar_one_or_none()
    return sem.id if sem else None


@router.get("")
async def list_past_research(
    keyword: str | None = None,
    year: int | None = None,
    semester: int | None = None,
    grade: int | None = None,
    report_type: str | None = None,
    field: str | None = None,
    status: str = Query("approved", description="approved|pending|rejected|all (admin only for !=approved)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    q = select(PastResearch)
    cq = select(func.count(PastResearch.id))

    # 학생/교사는 강제로 approved만 (검색 결과에 미승인 노출 차단)
    if user.role not in ("super_admin", "designated_admin") and status != "approved":
        status = "approved"

    conds = []
    if status != "all":
        conds.append(PastResearch.status == status)
    if keyword:
        kw = f"%{keyword.strip()}%"
        conds.append(or_(
            PastResearch.title.ilike(kw),
            PastResearch.original_filename.ilike(kw),
        ))
    if year is not None:
        conds.append(PastResearch.year == year)
    if semester is not None:
        conds.append(PastResearch.semester == semester)
    if grade is not None:
        conds.append(PastResearch.grade == grade)
    if report_type:
        conds.append(PastResearch.report_type == report_type)
    if field:
        # 단순 텍스트 매칭 (분야명이 짧고 unique). PG/SQLite 모두 호환.
        conds.append(func.cast(PastResearch.fields, SaString).ilike(f"%{field}%"))

    if conds:
        q = q.where(and_(*conds))
        cq = cq.where(and_(*conds))

    total = (await db.execute(cq)).scalar() or 0
    rows = (await db.execute(
        q.order_by(
            PastResearch.year.desc(),
            PastResearch.semester.desc().nulls_last(),
            PastResearch.title,
        )
        .offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "items": [_to_item(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/_facets")
async def get_facets(
    user: User = Depends(require_permission("past_research.view")),
    db: AsyncSession = Depends(get_db),
):
    """필터 옵션용 unique 값 모음."""
    years = (await db.execute(
        select(PastResearch.year).distinct().order_by(PastResearch.year.desc())
    )).scalars().all()
    types = (await db.execute(
        select(PastResearch.report_type).distinct().where(PastResearch.report_type.is_not(None))
    )).scalars().all()
    grades = (await db.execute(
        select(PastResearch.grade).distinct().where(PastResearch.grade.is_not(None)).order_by(PastResearch.grade)
    )).scalars().all()

    field_rows = (await db.execute(select(PastResearch.fields))).scalars().all()
    all_fields: set[str] = set()
    for fs in field_rows:
        for f in (fs or []):
            if isinstance(f, str) and f.strip():
                all_fields.add(f.strip())

    return {
        "years": [int(y) for y in years if y is not None],
        "report_types": sorted(t for t in types if t),
        "grades": [int(g) for g in grades if g is not None],
        "fields": sorted(all_fields),
    }


@router.post("/_bulk-upload")
async def bulk_upload(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("past_research.upload")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """ZIP 일괄 업로드. 파일명 자동 파싱.

    결과:
        success: 등록된 PDF 수
        skipped: 이미 등록되어 있어 건너뛴 항목 [{filename, reason}]
        failed:  파싱/검증 실패 [{filename, reason}]
    """
    data = await validate_upload(file, POLICY_PAST_RESEARCH_ZIP)

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(400, "잘못된 ZIP 파일")

    members = [n for n in zf.namelist() if not n.endswith("/")]
    if len(members) > MAX_PDFS_PER_ZIP:
        raise HTTPException(400, f"ZIP 내부 파일이 너무 많습니다 ({len(members)} > {MAX_PDFS_PER_ZIP})")

    await ensure_dir_async(Path(UPLOAD_DIR))

    success = 0
    skipped: list[dict] = []
    failed: list[dict] = []

    for member in members:
        # 일부 ZIP은 macOS 메타 폴더 포함 (__MACOSX) — skip
        if "__MACOSX" in member or os.path.basename(member).startswith("._"):
            continue

        # 파일명만 (디렉터리 경로 무시 — path traversal 방어 포함)
        try:
            raw_name = member.encode("cp437").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            raw_name = member
        display_name = os.path.basename(raw_name)

        if not display_name.lower().endswith(".pdf"):
            failed.append({"filename": display_name or member, "reason": "PDF 아님"})
            continue

        parsed = parse_filename(display_name)
        if not parsed:
            failed.append({
                "filename": display_name,
                "reason": "파일명 패턴 불일치 — '{YYYY} {N}학년 {S}학기 ... 보고서(분야)_제목.pdf' 형식 필요",
            })
            continue

        # 중복 검사 (year + title 동일하면 skip)
        existing = (await db.execute(
            select(PastResearch).where(
                PastResearch.year == parsed["year"],
                PastResearch.title == parsed["title"],
            )
        )).scalar_one_or_none()
        if existing:
            skipped.append({"filename": display_name, "reason": "이미 등록됨"})
            continue

        try:
            content = zf.read(member)
        except Exception as e:
            failed.append({"filename": display_name, "reason": f"읽기 실패: {e}"})
            continue

        if len(content) == 0:
            failed.append({"filename": display_name, "reason": "빈 파일"})
            continue
        if len(content) > MAX_PDF_SIZE:
            failed.append({
                "filename": display_name,
                "reason": f"PDF 크기 초과 ({len(content)} > {MAX_PDF_SIZE})",
            })
            continue
        if not content.startswith(b"%PDF-"):
            failed.append({"filename": display_name, "reason": "PDF 헤더 누락 (위조 파일?)"})
            continue

        stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.pdf")
        try:
            await write_bytes_async(Path(stored_path), content)
        except Exception as e:
            failed.append({"filename": display_name, "reason": f"저장 실패: {e}"})
            continue

        row = PastResearch(
            year=parsed["year"],
            grade=parsed["grade"],
            semester=parsed["semester"],
            report_type=parsed["report_type"],
            fields=parsed["fields"],
            title=parsed["title"],
            is_excellent=parsed["is_excellent"],
            original_filename=display_name,
            stored_path=stored_path,
            file_size=len(content),
            uploaded_by_id=user.id,
        )
        db.add(row)
        success += 1

    await db.flush()
    await log_action(
        db, user, "past_research.bulk_upload",
        f"success={success} skipped={len(skipped)} failed={len(failed)}",
        request=request,
    )

    return {"success": success, "skipped": skipped, "failed": failed}


@router.delete("/{rid}")
async def delete_past_research(
    rid: int,
    user: User = Depends(require_permission("past_research.delete")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    row = (await db.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)

    try:
        p = Path(row.stored_path)
        if p.exists():
            p.unlink()
    except Exception as e:
        # 파일 삭제 실패해도 DB row는 삭제 (orphan 방지)
        print(f"[past_research] 파일 삭제 실패: {e}")

    await db.delete(row)
    await db.flush()
    await log_action(db, user, "past_research.delete", f"id={rid}", request=request)
    return {"ok": True}


# ────────────────────────────────────────────────────────────
# 학생 자가 업로드 + 교사 승인 흐름
# ────────────────────────────────────────────────────────────


@router.post("/_submit")
async def student_submit(
    file: UploadFile = File(...),
    meta: str = Form(..., description="JSON: {year, grade, semester, report_type, fields, title, is_excellent}"),
    user: User = Depends(require_permission("past_research.submit")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """학생 본인 연구 보고서 업로드 → pending 상태로 저장 + 담당교사 알림."""
    if user.role != "student":
        raise HTTPException(403, "학생 전용 endpoint")

    try:
        meta_dict = json.loads(meta)
        m = StudentSubmitMeta(**meta_dict)
    except Exception as e:
        raise HTTPException(400, f"meta 파싱 실패: {e}")

    data = await validate_upload(file, POLICY_DOCUMENT)
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "PDF 파일만 업로드 가능합니다")

    # 본인의 담당 교사 조회 (현재 학기)
    semester_id = await _active_semester_id(db)
    supervisor_id: int | None = None
    if semester_id:
        sup = (await db.execute(
            select(ResearchSupervision).where(
                ResearchSupervision.semester_id == semester_id,
                ResearchSupervision.student_id == user.id,
            )
        )).scalar_one_or_none()
        if sup:
            supervisor_id = sup.supervisor_id
    if not supervisor_id:
        raise HTTPException(
            400,
            "담당 교사가 지정되지 않았습니다. 관리자 또는 담당 교사에게 등록을 요청하세요.",
        )

    await ensure_dir_async(Path(UPLOAD_DIR))
    stored_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.pdf")
    await write_bytes_async(Path(stored_path), data)

    standard_name = make_standard_filename(
        m.year, m.grade, m.semester, m.report_type, m.fields, m.title, m.is_excellent,
    )
    row = PastResearch(
        year=m.year,
        grade=m.grade,
        semester=m.semester,
        report_type=m.report_type,
        fields=m.fields,
        title=m.title,
        is_excellent=m.is_excellent,
        original_filename=standard_name,
        stored_path=stored_path,
        file_size=len(data),
        uploaded_by_id=user.id,
        submitted_by_student_id=user.id,
        supervisor_id=supervisor_id,
        status="pending",
    )
    db.add(row)
    await db.flush()

    # 담당 교사에게 알림
    await notify_users(
        db,
        user_ids=[supervisor_id],
        type="past_research.submitted",
        title=f"{user.name} 학생이 연구 보고서를 제출했습니다",
        body=m.title[:200],
        link_url="/research-review",
        source_user_id=user.id,
        meta={"past_research_id": row.id, "student_id": user.id},
    )

    await log_action(db, user, "past_research.submit", f"id={row.id}", request=request)
    return {"id": row.id, "status": row.status, "standard_filename": standard_name}


@router.patch("/{rid}/_review")
async def review_submission(
    rid: int,
    body: ReviewReq,
    user: User = Depends(require_permission("past_research.review")),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """담당 교사가 학생 제출 보고서 승인/거부.

    승인 시 StudentArtifact 자동 생성 (학생 산출물 갤러리 동시 등록).
    """
    row = (await db.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    if row.status != "pending":
        raise HTTPException(409, f"이미 처리된 보고서 (status={row.status})")

    # 본인이 supervisor이거나 admin만 가능
    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and row.supervisor_id != user.id:
        raise HTTPException(403, "담당 교사만 승인할 수 있습니다")

    row.status = body.status
    row.reviewed_at = datetime.now(timezone.utc)
    row.rejection_reason = body.rejection_reason if body.status == "rejected" else None

    if body.status == "approved" and row.submitted_by_student_id:
        # 학생 산출물 갤러리에 자동 등록
        artifact_id = await ensure_student_artifact(
            db,
            student_id=row.submitted_by_student_id,
            title=row.title,
            description=f"{row.year}년 {row.grade}학년 {row.semester}학기 {row.report_type}",
            category="report",
            file_url="/" + row.stored_path.replace("\\", "/"),
            file_name=row.original_filename,
            file_size=row.file_size,
            tags=list(row.fields or []),
            existing_id=row.student_artifact_id,
        )
        if artifact_id:
            row.student_artifact_id = artifact_id

    await db.flush()

    # 학생에게 결과 알림
    if row.submitted_by_student_id:
        if body.status == "approved":
            await notify_users(
                db,
                user_ids=[row.submitted_by_student_id],
                type="past_research.approved",
                title="연구 보고서가 승인되었습니다",
                body=f"{row.title} — 학생 산출물 갤러리에 등록되었습니다",
                link_url="/s/past-research",
                source_user_id=user.id,
                meta={"past_research_id": row.id},
            )
        else:
            await notify_users(
                db,
                user_ids=[row.submitted_by_student_id],
                type="past_research.rejected",
                title="연구 보고서가 반려되었습니다",
                body=body.rejection_reason or "사유 미기재",
                link_url="/s/research-submit",
                source_user_id=user.id,
                meta={"past_research_id": row.id, "reason": body.rejection_reason},
            )

    await log_action(
        db, user, f"past_research.{body.status}", f"id={rid}", request=request,
        is_sensitive=True,
    )
    return {"ok": True, "status": row.status}


@router.get("/_my/pending")
async def my_pending_reviews(
    user: User = Depends(require_permission("past_research.review")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 supervisor인 학생들의 pending 보고서 list."""
    q = select(PastResearch, User.name).join(
        User, User.id == PastResearch.submitted_by_student_id, isouter=True,
    ).where(
        PastResearch.status == "pending",
        PastResearch.supervisor_id == user.id,
    ).order_by(PastResearch.created_at.desc())
    rows = (await db.execute(q)).all()
    return {"items": [_to_item(p, name) for p, name in rows]}


@router.get("/_my/supervisor")
async def my_supervisor(
    user: User = Depends(require_permission("past_research.submit")),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인의 담당 교사 (현재 학기)."""
    semester_id = await _active_semester_id(db)
    if not semester_id:
        return {"supervisor": None, "semester_id": None}
    sup = (await db.execute(
        select(ResearchSupervision, User.name).join(
            User, User.id == ResearchSupervision.supervisor_id,
        ).where(
            ResearchSupervision.semester_id == semester_id,
            ResearchSupervision.student_id == user.id,
        )
    )).first()
    if not sup:
        return {"supervisor": None, "semester_id": semester_id}
    row, name = sup
    return {
        "supervisor": {"id": row.supervisor_id, "name": name, "topic_title": row.topic_title},
        "semester_id": semester_id,
    }


@router.get("/_my/supervised-students")
async def my_supervised_students(
    user: User = Depends(require_permission("past_research.supervise")),
    db: AsyncSession = Depends(get_db),
):
    """본인이 supervisor인 학생 list (현재 학기 + 메타)."""
    semester_id = await _active_semester_id(db)
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


# ── 담당교사 매핑 CRUD ──


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
    # 일반 교사는 본인 담당만 (admin은 전체)
    if user.role not in ("super_admin", "designated_admin"):
        conds.append(ResearchSupervision.supervisor_id == user.id)
    if conds:
        q = q.where(and_(*conds))
    rows = (await db.execute(q.order_by(ResearchSupervision.id.desc()))).scalars().all()

    # 이름 join (메모리)
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
                "student_name": users.get(r.student_id, type("X", (), {"name": None})).name if r.student_id in users else None,
                "student_username": users.get(r.student_id, type("X", (), {"username": None})).username if r.student_id in users else None,
                "supervisor_id": r.supervisor_id,
                "supervisor_name": users.get(r.supervisor_id, type("X", (), {"name": None})).name if r.supervisor_id in users else None,
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
    """담당교사 매핑 등록. 교사는 본인을 supervisor로만 등록 가능, admin은 모든 매핑 가능."""
    is_admin = user.role in ("super_admin", "designated_admin")
    if not is_admin and body.supervisor_id != user.id:
        raise HTTPException(403, "본인을 supervisor로만 등록할 수 있습니다")

    # 학생 존재 확인 + role 검증
    student = (await db.execute(select(User).where(User.id == body.student_id))).scalar_one_or_none()
    if not student or student.role != "student":
        raise HTTPException(400, "유효한 학생 ID가 아닙니다")
    supervisor = (await db.execute(select(User).where(User.id == body.supervisor_id))).scalar_one_or_none()
    if not supervisor or supervisor.role not in ("teacher", "staff", "super_admin", "designated_admin"):
        raise HTTPException(400, "유효한 교사 ID가 아닙니다")

    # 중복 (semester+student) 검사
    existing = (await db.execute(
        select(ResearchSupervision).where(
            ResearchSupervision.semester_id == body.semester_id,
            ResearchSupervision.student_id == body.student_id,
        )
    )).scalar_one_or_none()
    if existing:
        # 본인 admin이면 supervisor 변경 OK, 일반 교사면 본인이 이미 supervisor일 때만 OK
        if not is_admin and existing.supervisor_id != user.id:
            raise HTTPException(409, "이미 다른 교사가 담당 중입니다 (관리자에게 변경 요청)")
        existing.supervisor_id = body.supervisor_id
        existing.topic_title = body.topic_title
        existing.note = body.note
        await db.flush()
        result_id = existing.id
        # 학생에게 알림 (담당 변경)
        await notify_users(
            db, user_ids=[student.id],
            type="research_supervision.assigned",
            title=f"{supervisor.name} 선생님이 연구 담당으로 지정되었습니다",
            body=body.topic_title or None,
            link_url="/s/research-submit",
            source_user_id=user.id,
            meta={"supervisor_id": supervisor.id},
        )
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
