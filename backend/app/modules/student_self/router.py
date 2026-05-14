"""학생 본인 전용 라우터 — 산출물 업로드, 진로 설계, 과거 연구 열람"""

import os
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.research import ResearchProject
from app.models.student_self import StudentArtifact, StudentCareerPlan
from app.models.user import User

router = APIRouter(prefix="/api/me", tags=["student_self"])

ARTIFACT_DIR = Path(__file__).resolve().parents[3] / "storage" / "artifacts"
ALLOWED_EXTS = {".pdf", ".docx", ".doc", ".hwp", ".hwpx", ".ppt", ".pptx",
                ".xlsx", ".xls", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                ".mp4", ".mov", ".txt", ".md", ".zip"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def _require_student(user: User) -> None:
    if user.role != "student":
        raise HTTPException(403, "학생 전용 기능입니다")


def _artifact_to_dict(a: StudentArtifact) -> dict:
    return {
        "id": a.id, "title": a.title, "description": a.description,
        "category": a.category,
        "file_url": a.file_url, "file_name": a.file_name,
        "file_size": a.file_size, "mime_type": a.mime_type,
        "external_link": a.external_link,
        "tags": a.tags or [],
        "is_public": a.is_public,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


# ── 산출물 ──

@router.get("/artifacts")
async def list_my_artifacts(
    category: str | None = None,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    q = select(StudentArtifact).where(StudentArtifact.student_id == user.id)
    if category:
        q = q.where(StudentArtifact.category == category)
    rows = (await db.execute(q.order_by(desc(StudentArtifact.created_at)))).scalars().all()
    return {"items": [_artifact_to_dict(a) for a in rows]}


@router.post("/artifacts")
async def create_artifact(
    title: str = Form(...),
    description: str | None = Form(None),
    category: str = Form("other"),
    external_link: str | None = Form(None),
    is_public: bool = Form(False),
    tags: str | None = Form(None),  # comma-separated
    file: UploadFile | None = File(None),
    request: Request = None,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)

    file_url = None
    file_name = None
    file_size = None
    mime_type = None

    if file and file.filename:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTS:
            raise HTTPException(400, f"허용 확장자: {sorted(ALLOWED_EXTS)}")
        data = await file.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(400, "파일이 너무 큽니다 (최대 50MB)")

        student_dir = ARTIFACT_DIR / str(user.id)
        student_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time())
        safe_name = f"{ts}_{os.path.basename(file.filename)}"
        target = student_dir / safe_name
        target.write_bytes(data)
        file_url = f"/storage/artifacts/{user.id}/{safe_name}"
        file_name = file.filename
        file_size = len(data)
        mime_type = file.content_type

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()] if tags else []

    a = StudentArtifact(
        student_id=user.id,
        title=title, description=description, category=category,
        file_url=file_url, file_name=file_name,
        file_size=file_size, mime_type=mime_type,
        external_link=external_link, tags=tag_list,
        is_public=is_public,
    )
    db.add(a)
    await db.flush()
    await log_action(db, user, "student_artifact.create", target=f"id:{a.id}", request=request)
    return _artifact_to_dict(a)


@router.put("/artifacts/{aid}")
async def update_artifact(
    aid: int, body: dict, request: Request,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    a = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.id == aid, StudentArtifact.student_id == user.id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    for f in ("title", "description", "category", "external_link", "is_public", "tags"):
        if f in body:
            setattr(a, f, body[f])
    await log_action(db, user, "student_artifact.update", target=f"id:{aid}", request=request)
    return _artifact_to_dict(a)


@router.delete("/artifacts/{aid}")
async def delete_artifact(
    aid: int, request: Request,
    user: User = Depends(require_permission("student.artifact.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    a = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.id == aid, StudentArtifact.student_id == user.id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    # 파일 정리
    if a.file_url:
        rel = a.file_url.replace("/storage/", "", 1)
        full = ARTIFACT_DIR.parent / rel
        try:
            if full.exists():
                full.unlink()
        except OSError:
            pass
    await db.delete(a)
    await log_action(db, user, "student_artifact.delete", target=f"id:{aid}", request=request)
    return {"ok": True}


# 공개된 다른 학생 산출물 (과거/동기 참고용)
@router.get("/artifacts/public")
async def list_public_artifacts(
    category: str | None = None,
    limit: int = Query(50, le=200),
    user: User = Depends(require_permission("student.artifact.view_public")),
    db: AsyncSession = Depends(get_db),
):
    q = (select(StudentArtifact, User.name)
         .join(User, User.id == StudentArtifact.student_id)
         .where(StudentArtifact.is_public == True))
    if category:
        q = q.where(StudentArtifact.category == category)
    q = q.order_by(desc(StudentArtifact.created_at)).limit(limit)
    rows = (await db.execute(q)).all()
    return {"items": [
        {**_artifact_to_dict(a), "author_name": name}
        for a, name in rows
    ]}


# ── 진로/진학 설계 ──

def _plan_to_dict(p: StudentCareerPlan) -> dict:
    return {
        "id": p.id, "year": p.year,
        "desired_field": p.desired_field, "career_goal": p.career_goal,
        "target_universities": p.target_universities or [],
        "target_majors": p.target_majors or [],
        "academic_plan": p.academic_plan, "activity_plan": p.activity_plan,
        "semester_goals": p.semester_goals or [],
        "motivation": p.motivation, "notes": p.notes,
        "is_active": p.is_active,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


@router.get("/career-plans")
async def list_my_career_plans(
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    rows = (await db.execute(
        select(StudentCareerPlan).where(StudentCareerPlan.student_id == user.id)
        .order_by(desc(StudentCareerPlan.year), desc(StudentCareerPlan.updated_at))
    )).scalars().all()
    return {"items": [_plan_to_dict(p) for p in rows]}


@router.post("/career-plans")
async def create_career_plan(
    body: dict, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    year = body.get("year") or datetime.now().year
    p = StudentCareerPlan(
        student_id=user.id, year=year,
        desired_field=body.get("desired_field"),
        career_goal=body.get("career_goal"),
        target_universities=body.get("target_universities") or [],
        target_majors=body.get("target_majors") or [],
        academic_plan=body.get("academic_plan"),
        activity_plan=body.get("activity_plan"),
        semester_goals=body.get("semester_goals") or [],
        motivation=body.get("motivation"),
        notes=body.get("notes"),
    )
    db.add(p)
    await db.flush()
    await log_action(db, user, "student_career.create", target=f"year:{year}", request=request)
    return _plan_to_dict(p)


@router.put("/career-plans/{pid}")
async def update_career_plan(
    pid: int, body: dict, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.id == pid, StudentCareerPlan.student_id == user.id
        )
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    for f in ("desired_field", "career_goal", "target_universities", "target_majors",
              "academic_plan", "activity_plan", "semester_goals", "motivation", "notes",
              "is_active", "year"):
        if f in body:
            setattr(p, f, body[f])
    await log_action(db, user, "student_career.update", target=f"id:{pid}", request=request)
    return _plan_to_dict(p)


@router.delete("/career-plans/{pid}")
async def delete_career_plan(
    pid: int, request: Request,
    user: User = Depends(require_permission("student.career.manage")),
    db: AsyncSession = Depends(get_db),
):
    _require_student(user)
    p = (await db.execute(
        select(StudentCareerPlan).where(
            StudentCareerPlan.id == pid, StudentCareerPlan.student_id == user.id
        )
    )).scalar_one_or_none()
    if not p:
        raise HTTPException(404)
    await db.delete(p)
    await log_action(db, user, "student_career.delete", target=f"id:{pid}", request=request)
    return {"ok": True}


# ── 과거 연구 열람 ──

@router.get("/research/browse")
async def browse_alumni_research(
    keyword: str | None = None,
    year: int | None = None,
    research_type: str | None = None,
    limit: int = Query(50, le=200),
    user: User = Depends(require_permission("student.research.browse")),
    db: AsyncSession = Depends(get_db),
):
    """과거 학생들의 완료된 연구 목록.
    학생이 진로 탐색·연구 주제 잡을 때 참고용.
    민감 정보(개인 평가, 미공개 자료)는 제외하고 요약만 노출.
    """
    q = select(ResearchProject).where(ResearchProject.status.in_(["completed", "published"]))
    if keyword:
        q = q.where(ResearchProject.title.ilike(f"%{keyword}%"))
    if year:
        q = q.where(ResearchProject.year == year)
    if research_type:
        q = q.where(ResearchProject.research_type == research_type)

    q = q.order_by(desc(ResearchProject.year), desc(ResearchProject.created_at)).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    # advisor 이름 한 번에 조회
    advisor_ids = {r.advisor_id for r in rows if r.advisor_id}
    advisor_map: dict[int, str] = {}
    if advisor_ids:
        advs = (await db.execute(select(User).where(User.id.in_(advisor_ids)))).scalars().all()
        advisor_map = {u.id: u.name for u in advs}

    return {"items": [
        {
            "id": r.id, "title": r.title,
            "research_type": r.research_type,
            "description": (r.description or "")[:500],
            "year": r.year, "semester": r.semester,
            "status": r.status,
            "advisor_name": advisor_map.get(r.advisor_id) if r.advisor_id else None,
            "members": r.members or [],  # 보통 학생 이름 리스트
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]}


# ── 학생 본인 Dashboard 통계 ──

@router.get("/dashboard-stats")
async def my_dashboard_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 대시보드용 요약 통계.

    교사/관리자가 호출하면 0 또는 빈 값 (자기 학생 데이터 기준).
    학생만 의미있는 값 반환.
    """
    from sqlalchemy import func as sa_func
    from app.models.portfolio import StudentAward, StudentThesis
    from app.models.club import ClubSubmission
    from app.models.assignment import AssignmentSubmission

    awards_count = (await db.execute(
        select(sa_func.count(StudentAward.id)).where(StudentAward.student_id == user.id)
    )).scalar() or 0
    theses_count = (await db.execute(
        select(sa_func.count(StudentThesis.id)).where(StudentThesis.student_id == user.id)
    )).scalars().first() or 0
    club_activities = (await db.execute(
        select(sa_func.count(ClubSubmission.id)).where(ClubSubmission.author_id == user.id)
    )).scalar() or 0
    assignments_submitted = (await db.execute(
        select(sa_func.count(AssignmentSubmission.id)).where(AssignmentSubmission.user_id == user.id)
    )).scalar() or 0
    artifacts_count = (await db.execute(
        select(sa_func.count(StudentArtifact.id)).where(StudentArtifact.student_id == user.id)
    )).scalar() or 0

    return {
        "awards_count": int(awards_count),
        "theses_count": int(theses_count),
        "club_activities": int(club_activities),
        "assignments_submitted": int(assignments_submitted),
        "artifacts_count": int(artifacts_count),
    }


# ── 학생 본인 통합 활동 (포트폴리오 페이지) ──

@router.get("/assignment-submissions")
async def my_assignment_submissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 제출한 과제 목록 + 노출 토글 상태."""
    from app.models.assignment import Assignment, AssignmentSubmission
    rows = (await db.execute(
        select(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .where(AssignmentSubmission.user_id == user.id)
        .order_by(desc(AssignmentSubmission.submitted_at))
    )).all()
    return {
        "items": [
            {
                "id": s.id,
                "assignment_id": s.assignment_id,
                "assignment_title": a.title,
                "subject": a.subject,
                "filename": s.filename,
                "file_size": s.file_size,
                "status": s.status.value if hasattr(s.status, "value") else s.status,
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "review_comment": s.review_comment,
                "show_in_portfolio": bool(s.show_in_portfolio),
            }
            for s, a in rows
        ]
    }


@router.put("/assignment-submissions/{sub_id}/portfolio-visibility")
async def toggle_submission_portfolio_visibility(
    sub_id: int,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 제출물의 포트폴리오 노출 토글.

    show_in_portfolio=True면 /students/artifacts-gallery 공개 갤러리,
    PDF 생기부 등에 자동 포함.
    """
    from app.models.assignment import AssignmentSubmission
    s = (await db.execute(
        select(AssignmentSubmission).where(
            AssignmentSubmission.id == sub_id,
            AssignmentSubmission.user_id == user.id,  # 본인만
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 제출물만 토글 가능합니다")
    s.show_in_portfolio = bool(body.get("show_in_portfolio", False))
    await db.flush()
    return {"id": s.id, "show_in_portfolio": s.show_in_portfolio}


@router.delete("/assignment-submissions/{sub_id}")
async def delete_my_assignment_submission(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 제출한 과제를 삭제 (마감 전이거나 reviewed 전인 경우만).

    교사가 이미 검토(reviewed)한 제출물은 무결성을 위해 학생 단독 삭제 차단.
    """
    from app.models.assignment import AssignmentSubmission, SubmissionStatus
    s = (await db.execute(
        select(AssignmentSubmission).where(
            AssignmentSubmission.id == sub_id,
            AssignmentSubmission.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 제출물만 삭제 가능합니다")
    if s.status in (SubmissionStatus.REVIEWED, SubmissionStatus.ACCEPTED, SubmissionStatus.REJECTED):
        raise HTTPException(400, "이미 교사가 검토한 제출물은 삭제할 수 없습니다 (교사에게 요청하세요)")
    await db.delete(s)
    await db.flush()
    return {"ok": True, "id": sub_id}


@router.put("/club-submissions/{sub_id}")
async def update_my_club_submission(
    sub_id: int,
    body: dict,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 동아리 산출물의 메타(제목/유형) 수정."""
    from app.models.club import ClubSubmission
    s = (await db.execute(
        select(ClubSubmission).where(
            ClubSubmission.id == sub_id,
            ClubSubmission.author_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 산출물만 수정 가능합니다")
    if "title" in body:
        t = (body["title"] or "").strip()
        if not t:
            raise HTTPException(400, "제목은 비울 수 없습니다")
        s.title = t[:200]
    if "submission_type" in body:
        st = (body["submission_type"] or "").strip()
        if st:
            s.submission_type = st[:30]
    await db.flush()
    return {"id": s.id, "title": s.title, "submission_type": s.submission_type}


@router.delete("/club-submissions/{sub_id}")
async def delete_my_club_submission(
    sub_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 동아리 산출물 삭제."""
    from app.models.club import ClubSubmission
    s = (await db.execute(
        select(ClubSubmission).where(
            ClubSubmission.id == sub_id,
            ClubSubmission.author_id == user.id,
        )
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "본인의 산출물만 삭제 가능합니다")
    await db.delete(s)
    await db.flush()
    return {"ok": True, "id": sub_id}


@router.get("/club-submissions")
async def my_club_submissions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인이 동아리에 제출한 산출물."""
    from app.models.club import Club, ClubSubmission
    rows = (await db.execute(
        select(ClubSubmission, Club)
        .join(Club, Club.id == ClubSubmission.club_id)
        .where(ClubSubmission.author_id == user.id)
        .order_by(desc(ClubSubmission.created_at))
    )).all()
    return {
        "items": [
            {
                "id": s.id,
                "club_id": s.club_id,
                "club_name": c.name,
                "title": s.title,
                "submission_type": s.submission_type,
                "file_path": s.file_path,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s, c in rows
        ]
    }


@router.get("/all-activities")
async def my_all_activities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """학생 본인 모든 활동 통합 (포트폴리오 단일 timeline).

    종류: 자유 업로드 산출물 / 과제 제출물 / 동아리 산출물.
    최신순.
    """
    from app.models.assignment import Assignment, AssignmentSubmission
    from app.models.club import Club, ClubSubmission

    artifacts = (await db.execute(
        select(StudentArtifact).where(StudentArtifact.student_id == user.id)
        .order_by(desc(StudentArtifact.created_at))
    )).scalars().all()

    submissions = (await db.execute(
        select(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .where(AssignmentSubmission.user_id == user.id)
        .order_by(desc(AssignmentSubmission.submitted_at))
    )).all()

    club_subs = (await db.execute(
        select(ClubSubmission, Club)
        .join(Club, Club.id == ClubSubmission.club_id)
        .where(ClubSubmission.author_id == user.id)
        .order_by(desc(ClubSubmission.created_at))
    )).all()

    timeline = []
    for a in artifacts:
        timeline.append({
            "type": "artifact",
            "id": a.id,
            "title": a.title,
            "category": a.category,
            "description": a.description,
            "file_url": a.file_url,
            "file_name": a.file_name,
            "is_public": a.is_public,
            "date": a.created_at.isoformat() if a.created_at else None,
        })
    for s, asn in submissions:
        timeline.append({
            "type": "assignment_submission",
            "id": s.id,
            "title": asn.title,
            "subject": asn.subject,
            "filename": s.filename,
            "status": s.status.value if hasattr(s.status, "value") else s.status,
            "review_comment": s.review_comment,
            "show_in_portfolio": bool(s.show_in_portfolio),
            "date": s.submitted_at.isoformat() if s.submitted_at else None,
        })
    for cs, club in club_subs:
        timeline.append({
            "type": "club_submission",
            "id": cs.id,
            "title": cs.title,
            "club_name": club.name,
            "submission_type": cs.submission_type,
            "file_path": cs.file_path,
            "date": cs.created_at.isoformat() if cs.created_at else None,
        })

    timeline.sort(key=lambda x: x.get("date") or "", reverse=True)
    return {"items": timeline}
