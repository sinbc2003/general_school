"""클래스룸 스프레드시트 router — CRUD + 멤버 + Yjs snapshot.

ClassroomDocument와 동일 패턴. Univer 워크북의 CRDT 상태는 Hocuspocus가
documentName="sheet-{id}"로 매핑해서 동시 편집.

경로:
  GET    /api/classroom/sheets                    list (mine, course_id 필터)
  POST   /api/classroom/sheets                    create
  GET    /api/classroom/sheets/{sid}              detail
  PUT    /api/classroom/sheets/{sid}              update meta
  DELETE /api/classroom/sheets/{sid}              delete

  GET    /api/classroom/sheets/{sid}/members      list members
  POST   /api/classroom/sheets/{sid}/members      add member
  DELETE /api/classroom/sheets/{sid}/members/{mid}  remove member

  Hocuspocus 내부:
  GET    /api/classroom/sheets/{sid}/permission   (INTERNAL_TOKEN)
  GET    /api/classroom/sheets/{sid}/yjs-snapshot (INTERNAL_TOKEN)
  POST   /api/classroom/sheets/{sid}/yjs-snapshot (INTERNAL_TOKEN)

  연동:
  POST   /api/classroom/sheets/_from-survey/{sid} 설문 결과 → 새 시트 생성
"""

import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_action
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.permissions import require_permission
from app.core.quota import adjust_quota
from app.models.classroom import Course, CourseStudent
from app.models.course_teacher import CourseTeacher
from app.models.classroom_sheets import ClassroomSheet, SheetMember
from app.models.classroom_surveys import (
    Survey, SurveyAnswer, SurveyQuestion, SurveyResponse,
)
from app.models.user import User
from app.services.attachment_share import attachment_share_access
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/classroom/sheets", tags=["classroom-sheets"])


# ── Pydantic schemas ──

class SheetCreate(BaseModel):
    title: str = Field("제목 없는 스프레드시트", min_length=1, max_length=255)
    course_id: int | None = None
    access_mode: str = "specific_users"


class SheetUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    access_mode: str | None = None
    is_archived: bool | None = None
    settings: dict | None = None


class SheetMemberAdd(BaseModel):
    user_id: int
    role: str = "editor"


class SnapshotIn(BaseModel):
    state_base64: str = Field(..., min_length=1)


# ── helpers ──

from app.core.permissions import is_admin as _is_admin  # SSOT
from app.core.course_access import is_course_teacher  # owner+co_teacher (router-free SSOT)


def _to_dict(s: ClassroomSheet, *, owner_name: str | None = None) -> dict:
    return {
        "id": s.id,
        "course_id": s.course_id,
        "owner_id": s.owner_id,
        "owner_name": owner_name,
        "title": s.title,
        "access_mode": s.access_mode,
        "is_archived": s.is_archived,
        "source_survey_id": s.source_survey_id,
        "settings": s.settings or {},
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


async def _resolve_permission(db: AsyncSession, user: User, sh: ClassroomSheet) -> dict:
    """접근 권한 — ClassroomDocument와 동일 매트릭스."""
    if sh.owner_id == user.id:
        return {"can_read": True, "can_write": True, "can_share": True, "role": "owner"}
    if _is_admin(user):
        return {"can_read": True, "can_write": True, "can_share": True, "role": "admin"}

    if sh.access_mode == "course_members" and sh.course_id is not None:
        course = await db.get(Course, sh.course_id)
        if course:
            if await is_course_teacher(db, course, user):
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
            cs = (await db.execute(
                select(CourseStudent).where(
                    CourseStudent.course_id == sh.course_id,
                    CourseStudent.student_id == user.id,
                    CourseStudent.status == "active",
                )
            )).scalar_one_or_none()
            if cs:
                return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}

    if sh.access_mode == "specific_users":
        m = (await db.execute(
            select(SheetMember).where(
                SheetMember.sheet_id == sh.id,
                SheetMember.user_id == user.id,
            )
        )).scalar_one_or_none()
        if m:
            return {
                "can_read": True, "can_write": m.role == "editor",
                "can_share": False, "role": m.role,
            }

    # 글 첨부 share_mode (Google Classroom '파일 공유 옵션') — additive.
    share = await attachment_share_access(db, user, "sheet", sh.id)
    if share == "edit":
        return {"can_read": True, "can_write": True, "can_share": False, "role": "editor"}
    if share == "view":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    if sh.access_mode == "link_public":
        return {"can_read": True, "can_write": False, "can_share": False, "role": "viewer"}

    return {"can_read": False, "can_write": False, "can_share": False, "role": None}


# ── CRUD ──

@router.get("")
async def list_sheets(
    course_id: int | None = Query(None),
    mine: bool = Query(False),
    include_archived: bool = Query(False),
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    """접근 가능 시트 목록. mine=true면 본인 작성만."""
    base = select(ClassroomSheet)
    if course_id is not None:
        base = base.where(ClassroomSheet.course_id == course_id)
    if not include_archived:
        base = base.where(ClassroomSheet.is_archived.is_(False))

    if mine:
        q = base.where(ClassroomSheet.owner_id == user.id)
    elif _is_admin(user):
        q = base
    else:
        teacher_course_ids = (await db.execute(
            select(Course.id).where(or_(
                Course.teacher_id == user.id,
                Course.id.in_(
                    select(CourseTeacher.course_id).where(CourseTeacher.user_id == user.id)
                ),
            ))
        )).scalars().all()
        student_course_ids = (await db.execute(
            select(CourseStudent.course_id).where(
                CourseStudent.student_id == user.id,
                CourseStudent.status == "active",
            )
        )).scalars().all()
        course_ids = list(set(teacher_course_ids) | set(student_course_ids))

        member_sheet_ids = (await db.execute(
            select(SheetMember.sheet_id).where(SheetMember.user_id == user.id)
        )).scalars().all()

        conds = [ClassroomSheet.owner_id == user.id]
        if course_ids:
            conds.append(
                (ClassroomSheet.access_mode == "course_members") &
                (ClassroomSheet.course_id.in_(course_ids))
            )
        if member_sheet_ids:
            conds.append(ClassroomSheet.id.in_(member_sheet_ids))
        q = base.where(or_(*conds))

    q = q.order_by(desc(ClassroomSheet.updated_at)).limit(200)
    rows = (await db.execute(q)).scalars().all()

    owner_ids = {s.owner_id for s in rows}
    owners: dict[int, str] = {}
    if owner_ids:
        urows = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all()
        owners = {u.id: u.name for u in urows}

    return {"items": [_to_dict(s, owner_name=owners.get(s.owner_id)) for s in rows]}


@router.post("")
async def create_sheet(
    body: SheetCreate, request: Request,
    user: User = Depends(require_permission("classroom.sheet.create")),
    db: AsyncSession = Depends(get_db),
):
    if body.course_id is not None:
        course = await db.get(Course, body.course_id)
        if not course:
            raise HTTPException(404, "강좌 없음")
        if not _is_admin(user) and course.teacher_id != user.id:
            raise HTTPException(403, "본인 강좌에만 생성 가능")
    sh = ClassroomSheet(
        course_id=body.course_id,
        owner_id=user.id,
        title=body.title,
        access_mode=body.access_mode,
    )
    db.add(sh)
    await db.flush()
    await log_action(
        db, user, "classroom.sheet.create",
        target=f"sheet:{sh.id} course:{body.course_id}", request=request,
    )
    return _to_dict(sh, owner_name=user.name)


@router.get("/{sid}")
async def get_sheet(
    sid: int,
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_read"]:
        raise HTTPException(403, "시트 열람 권한이 없습니다")
    owner = await db.get(User, sh.owner_id)
    return {
        **_to_dict(sh, owner_name=owner.name if owner else None),
        "permission": perm,
    }


@router.put("/{sid}")
async def update_sheet(
    sid: int, body: SheetUpdate, request: Request,
    user: User = Depends(require_permission("classroom.sheet.edit")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")
    if body.access_mode is not None and body.access_mode != sh.access_mode:
        if not perm["can_share"]:
            raise HTTPException(403, "공유 설정은 소유자만")
    patch = body.model_dump(exclude_unset=True)
    for k, v in patch.items():
        if v is not None:
            setattr(sh, k, v)
    await db.flush()
    # onupdate=func.now() 영향으로 _to_dict 전 refresh 필요 (MissingGreenlet 회피)
    await db.refresh(sh)
    owner = await db.get(User, sh.owner_id)
    return _to_dict(sh, owner_name=owner.name if owner else None)


@router.delete("/{sid}")
async def delete_sheet(
    sid: int, request: Request,
    user: User = Depends(require_permission("classroom.sheet.edit")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    if sh.owner_id != user.id and not _is_admin(user):
        raise HTTPException(403, "소유자 또는 관리자만 삭제 가능")
    await db.delete(sh)
    await log_action(db, user, "classroom.sheet.delete", target=f"sheet:{sid}", request=request)
    return {"ok": True}


# ── 멤버 ──

@router.get("/{sid}/members")
async def list_members(
    sid: int,
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_read"]:
        raise HTTPException(403)
    rows = (await db.execute(
        select(SheetMember, User.name, User.email)
        .join(User, User.id == SheetMember.user_id)
        .where(SheetMember.sheet_id == sid)
    )).all()
    return {
        "items": [
            # ShareDocModal 공통 형식 — user_name (문서/슬라이드와 동일)
            {
                "id": m.id, "user_id": m.user_id,
                "user_name": name, "name": name,  # 호환 — 둘 다 채움
                "email": email, "role": m.role,
            }
            for m, name, email in rows
        ]
    }


@router.post("/{sid}/members")
async def add_member(
    sid: int, body: SheetMemberAdd, request: Request,
    user: User = Depends(require_permission("classroom.sheet.edit")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_share"]:
        raise HTTPException(403, "공유 권한은 소유자/관리자만")
    target = await db.get(User, body.user_id)
    if not target:
        raise HTTPException(404, "사용자 없음")
    existing = (await db.execute(
        select(SheetMember).where(
            SheetMember.sheet_id == sid, SheetMember.user_id == body.user_id,
        )
    )).scalar_one_or_none()
    if existing:
        existing.role = body.role
        await db.flush()
        return {"id": existing.id, "user_id": body.user_id, "role": existing.role, "updated": True}
    m = SheetMember(sheet_id=sid, user_id=body.user_id, role=body.role)
    db.add(m)
    await db.flush()
    await log_action(db, user, "classroom.sheet.member.add",
                     target=f"sheet:{sid} user:{body.user_id}", request=request)
    return {"id": m.id, "user_id": body.user_id, "role": m.role}


@router.delete("/{sid}/members/{mid}")
async def remove_member(
    sid: int, mid: int,
    user: User = Depends(require_permission("classroom.sheet.edit")),
    db: AsyncSession = Depends(get_db),
):
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_share"]:
        raise HTTPException(403)
    m = await db.get(SheetMember, mid)
    if not m or m.sheet_id != sid:
        raise HTTPException(404)
    await db.delete(m)
    return {"ok": True}


# ── 사용자 자체 snapshot (Univer auto-save용. JWT 인증, can_write 가드) ──
# yjs-snapshot은 Hocuspocus가 internal token으로 호출하는 별도 경로.

@router.get("/{sid}/snapshot-state")
async def get_user_snapshot(
    sid: int,
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    """시트 열 때 frontend가 호출 — 사용자 JWT 인증.

    Univer Workbook JSON snapshot을 base64로 반환. yjs_state 컬럼 재활용
    (실시간 협업 phase까지는 단순 snapshot으로 사용).
    """
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_read"]:
        raise HTTPException(403, "시트 열람 권한이 없습니다")
    if not sh.yjs_state:
        return {"state_base64": None}
    return {"state_base64": base64.b64encode(sh.yjs_state).decode("ascii")}


@router.post("/{sid}/snapshot-state")
async def put_user_snapshot(
    sid: int, body: SnapshotIn,
    user: User = Depends(require_permission("classroom.sheet.edit")),
    db: AsyncSession = Depends(get_db),
):
    """auto-save — frontend가 5초 디바운스로 호출. can_write 가드."""
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    perm = await _resolve_permission(db, user, sh)
    if not perm["can_write"]:
        raise HTTPException(403, "편집 권한 없음")
    try:
        data = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "잘못된 base64")
    # 크기 제한 (10MB) — 악의적 큰 데이터 차단
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "snapshot이 너무 큽니다 (10MB 한도)")
    old_bytes = sh.storage_bytes or 0
    sh.yjs_state = data
    sh.storage_bytes = len(data)
    new_bytes = sh.storage_bytes
    await db.flush()

    # quota 조정 (best-effort)
    try:
        owner = await db.get(User, sh.owner_id)
        if owner:
            await adjust_quota(db, owner, old_bytes=old_bytes, new_bytes=new_bytes)
    except Exception:
        pass

    return {"ok": True, "byte_size": len(data)}


# ── Hocuspocus 사이드카 연동 endpoint (classroom_docs와 동일 패턴) ──

@router.get("/{sid}/permission")
async def check_sheet_permission(
    sid: int,
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus WS auth 단계에서 호출 — 사용자 JWT 인증."""
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    if sh.is_archived:
        perm = await _resolve_permission(db, user, sh)
        perm["can_write"] = False
        return perm
    return await _resolve_permission(db, user, sh)


@router.get("/{sid}/yjs-snapshot")
async def get_yjs_snapshot(
    sid: int,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """문서 초기 로딩 — INTERNAL_TOKEN 인증 (Hocuspocus 전용)."""
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")

    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    if sh.yjs_state is None:
        return {"state_base64": None, "sheet_id": sid}
    return {
        "state_base64": base64.b64encode(sh.yjs_state).decode("ascii"),
        "sheet_id": sid,
    }


@router.post("/{sid}/yjs-snapshot")
async def put_yjs_snapshot(
    sid: int, body: SnapshotIn,
    x_internal_token: str | None = Header(None, alias="X-Internal-Token"),
    db: AsyncSession = Depends(get_db),
):
    """Hocuspocus 주기 저장 — INTERNAL_TOKEN 인증."""
    expected = app_settings.HOCUSPOCUS_INTERNAL_TOKEN
    if not expected:
        raise HTTPException(503, "HOCUSPOCUS_INTERNAL_TOKEN 미설정")
    if x_internal_token != expected:
        raise HTTPException(401, "내부 토큰 인증 실패")
    sh = await db.get(ClassroomSheet, sid)
    if not sh:
        raise HTTPException(404)
    try:
        data = base64.b64decode(body.state_base64)
    except Exception:
        raise HTTPException(400, "잘못된 base64")
    old_bytes = sh.storage_bytes or 0
    sh.yjs_state = data
    sh.storage_bytes = len(data)
    new_bytes = sh.storage_bytes
    await db.flush()

    # quota 조정 (best-effort)
    try:
        owner = await db.get(User, sh.owner_id)
        if owner:
            await adjust_quota(db, owner, old_bytes=old_bytes, new_bytes=new_bytes)
    except Exception:
        pass

    return {"ok": True, "byte_size": len(data)}


# ── 설문 → 시트 생성 ──

@router.post("/_from-survey/{survey_id}")
async def create_sheet_from_survey(
    survey_id: int, request: Request,
    user: User = Depends(require_permission("classroom.sheet.create")),
    db: AsyncSession = Depends(get_db),
):
    """설문 응답 데이터를 새 스프레드시트로 — 결과 분석·메모용.

    생성된 시트는 access_mode=specific_users (소유자만 자동 접근). 다른 교사와
    분석하려면 [공유] 메뉴로 SheetMember 추가.

    초기 yjs_state는 비워둠 — frontend가 시트 열 때 응답 데이터를 Univer
    워크북에 주입 (서버는 raw 데이터만 가지고 있고 frontend가 표 형식 구성).
    """
    s = await db.get(Survey, survey_id)
    if not s:
        raise HTTPException(404, "설문을 찾을 수 없습니다")
    if not _is_admin(user) and s.author_id != user.id:
        raise HTTPException(403, "본인 설문만 시트로 변환 가능")

    sh = ClassroomSheet(
        course_id=s.course_id,
        owner_id=user.id,
        title=f"[설문 응답] {s.title}",
        access_mode="specific_users",
        source_survey_id=survey_id,
    )
    db.add(sh)
    await db.flush()
    await log_action(
        db, user, "classroom.sheet.from_survey",
        target=f"sheet:{sh.id} survey:{survey_id}", request=request,
    )
    return _to_dict(sh, owner_name=user.name)


@router.get("/_survey-data/{survey_id}")
async def get_survey_data_for_sheet(
    survey_id: int,
    user: User = Depends(require_permission("classroom.sheet.view")),
    db: AsyncSession = Depends(get_db),
):
    """시트 열 때 응답 데이터를 표 형식으로 반환 — frontend가 Univer에 주입.

    응답 형식: { "headers": [...], "rows": [[...], ...] }
    """
    s = await db.get(Survey, survey_id)
    if not s:
        raise HTTPException(404)
    if not _is_admin(user) and s.author_id != user.id:
        raise HTTPException(403, "본인 설문만 조회 가능")

    qs = (await db.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == survey_id)
        .order_by(SurveyQuestion.order, SurveyQuestion.id)
    )).scalars().all()

    responses = (await db.execute(
        select(SurveyResponse).where(SurveyResponse.survey_id == survey_id)
        .order_by(SurveyResponse.submitted_at)
    )).scalars().all()
    response_ids = [r.id for r in responses]
    answers = []
    if response_ids:
        answers = (await db.execute(
            select(SurveyAnswer).where(SurveyAnswer.response_id.in_(response_ids))
        )).scalars().all()
    answers_by_resp: dict[int, dict[int, SurveyAnswer]] = {}
    for a in answers:
        answers_by_resp.setdefault(a.response_id, {})[a.question_id] = a

    respondent_ids = {r.respondent_id for r in responses if r.respondent_id}
    respondents: dict[int, str] = {}
    if respondent_ids and not s.is_anonymous:
        urows = (await db.execute(select(User).where(User.id.in_(respondent_ids)))).scalars().all()
        respondents = {u.id: u.name for u in urows}

    headers = ["응답ID", "응답자", "제출시각"] + [q.question_text for q in qs]
    rows = []
    for r in responses:
        row = [
            r.id,
            "(익명)" if s.is_anonymous else respondents.get(r.respondent_id or 0, ""),
            r.submitted_at.isoformat() if r.submitted_at else "",
        ]
        ans_map = answers_by_resp.get(r.id, {})
        for q in qs:
            a = ans_map.get(q.id)
            if not a:
                row.append("")
            elif q.question_type in ("short_text", "long_text", "date"):
                row.append(a.text_value or "")
            elif q.question_type in ("single_choice", "multi_choice"):
                row.append(" | ".join(a.choice_values or []))
            elif q.question_type == "rating":
                row.append(a.rating_value if a.rating_value is not None else "")
            else:
                row.append("")
        rows.append(row)

    return {"headers": headers, "rows": rows, "survey_title": s.title}
