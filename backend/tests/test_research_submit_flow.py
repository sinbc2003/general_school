"""학생 연구 보고서 제출 → 교사 승인/거부 → StudentArtifact 흐름.

검증:
- 학생 _submit: supervisor 없으면 400
- 교사 _review approved → status + StudentArtifact 자동 생성
- 교사 _review rejected → reason + 학생 알림
- 비 supervisor 교사는 review 차단
- list endpoint는 학생/교사에게 status='approved'만
"""

from __future__ import annotations

import json
from datetime import date

import pytest
from sqlalchemy import select

from app.models import (
    Notification, PastResearch, ResearchSupervision, Semester, StudentArtifact,
)


async def _make_semester(db, year=2026):
    s = Semester(
        year=year, semester=1, name=f"{year} 1학기",
        start_date=date(year, 3, 1), end_date=date(year, 8, 31),
        is_current=True,
    )
    db.add(s)
    await db.flush()
    return s


PDF_HEADER = b"%PDF-1.4\n%\xc4\xe5\xf2\xe5\xeb\xa7\xf3\xa0\xd0\xc4\xc6\n"


@pytest.mark.security
@pytest.mark.asyncio
async def test_student_submit_without_supervisor_rejected(
    app_client, db_session, student_user, auth_headers,
):
    """담당 교사 매핑 없으면 학생 제출 400."""
    await _make_semester(db_session)
    await db_session.commit()

    meta = {"year": 2026, "grade": 2, "semester": 1, "report_type": "과학과제연구",
            "fields": ["물리"], "title": "테스트", "is_excellent": False}
    r = await app_client.post(
        "/api/past-research/_submit",
        data={"meta": json.dumps(meta)},
        files={"file": ("test.pdf", PDF_HEADER + b"data", "application/pdf")},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 400
    assert "담당" in r.json()["detail"]


@pytest.mark.security
@pytest.mark.asyncio
async def test_full_submit_approve_flow(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """제출 → 교사 승인 → status=approved + StudentArtifact + 학생 알림."""
    semester = await _make_semester(db_session)
    db_session.add(ResearchSupervision(
        semester_id=semester.id, student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    await db_session.commit()

    # 1) 학생 제출
    meta = {"year": 2026, "grade": 2, "semester": 1, "report_type": "과학과제연구",
            "fields": ["물리", "화학"], "title": "두 약물 부작용", "is_excellent": False}
    r = await app_client.post(
        "/api/past-research/_submit",
        data={"meta": json.dumps(meta)},
        files={"file": ("test.pdf", PDF_HEADER + b"content", "application/pdf")},
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    rid = r.json()["id"]

    # 표준 파일명 확인
    assert "두 약물 부작용" in r.json()["standard_filename"]

    # supervisor에게 알림 갔는지
    notif = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == teacher_user.id,
            Notification.type == "past_research.submitted",
        )
    )).scalar_one_or_none()
    assert notif is not None

    # 2) supervisor 승인
    r2 = await app_client.patch(
        f"/api/past-research/{rid}/_review",
        json={"status": "approved"},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200

    # PastResearch.status='approved' + student_artifact_id 채워짐
    row = (await db_session.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one()
    assert row.status == "approved"
    assert row.student_artifact_id is not None

    # StudentArtifact 자동 생성
    artifact = await db_session.get(StudentArtifact, row.student_artifact_id)
    assert artifact is not None
    assert artifact.student_id == student_user.id
    assert "두 약물 부작용" in artifact.title

    # 학생에게 approved 알림
    student_notif = (await db_session.execute(
        select(Notification).where(
            Notification.user_id == student_user.id,
            Notification.type == "past_research.approved",
        )
    )).scalar_one_or_none()
    assert student_notif is not None


@pytest.mark.security
@pytest.mark.asyncio
async def test_review_rejected_with_reason(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    semester = await _make_semester(db_session)
    db_session.add(ResearchSupervision(
        semester_id=semester.id, student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    await db_session.commit()

    meta = {"year": 2026, "grade": 2, "semester": 1, "report_type": "과학과제연구",
            "fields": ["물리"], "title": "반려 테스트", "is_excellent": False}
    r = await app_client.post(
        "/api/past-research/_submit",
        data={"meta": json.dumps(meta)},
        files={"file": ("test.pdf", PDF_HEADER + b"data", "application/pdf")},
        headers=auth_headers(student_user),
    )
    rid = r.json()["id"]

    r2 = await app_client.patch(
        f"/api/past-research/{rid}/_review",
        json={"status": "rejected", "rejection_reason": "분량 부족"},
        headers=auth_headers(teacher_user),
    )
    assert r2.status_code == 200

    row = (await db_session.execute(
        select(PastResearch).where(PastResearch.id == rid)
    )).scalar_one()
    assert row.status == "rejected"
    assert row.rejection_reason == "분량 부족"
    assert row.student_artifact_id is None  # 거부면 artifact 없음


@pytest.mark.security
@pytest.mark.asyncio
async def test_non_supervisor_cannot_review(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    semester = await _make_semester(db_session)
    db_session.add(ResearchSupervision(
        semester_id=semester.id, student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    await db_session.commit()

    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="other_t@test.local", name="Other", role="teacher",
    )
    await db_session.commit()

    meta = {"year": 2026, "grade": 2, "semester": 1, "report_type": "과학과제연구",
            "fields": ["물리"], "title": "권한 테스트", "is_excellent": False}
    r = await app_client.post(
        "/api/past-research/_submit",
        data={"meta": json.dumps(meta)},
        files={"file": ("test.pdf", PDF_HEADER + b"data", "application/pdf")},
        headers=auth_headers(student_user),
    )
    rid = r.json()["id"]

    # 다른 교사가 review 시도 → 403
    r2 = await app_client.patch(
        f"/api/past-research/{rid}/_review",
        json={"status": "approved"},
        headers=auth_headers(other),
    )
    assert r2.status_code == 403


@pytest.mark.security
@pytest.mark.asyncio
async def test_list_hides_pending_from_students(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """학생은 list에서 approved만 봄 (pending 노출 X)."""
    semester = await _make_semester(db_session)
    db_session.add_all([
        PastResearch(
            year=2026, grade=2, semester=1, report_type="X",
            fields=[], title="approved item",
            original_filename="a.pdf", stored_path="storage/past_research/a.pdf",
            file_size=100, status="approved",
        ),
        PastResearch(
            year=2026, grade=2, semester=1, report_type="X",
            fields=[], title="pending item",
            original_filename="p.pdf", stored_path="storage/past_research/p.pdf",
            file_size=100, status="pending",
        ),
    ])
    await db_session.commit()

    r = await app_client.get("/api/past-research", headers=auth_headers(student_user))
    items = r.json()["items"]
    titles = [i["title"] for i in items]
    assert "approved item" in titles
    assert "pending item" not in titles


@pytest.mark.security
@pytest.mark.asyncio
async def test_my_pending_queue(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """본인 supervisor인 학생들의 pending만 보임."""
    semester = await _make_semester(db_session)
    db_session.add(ResearchSupervision(
        semester_id=semester.id, student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    db_session.add(PastResearch(
        year=2026, grade=2, semester=1, report_type="X",
        fields=[], title="pending mine",
        original_filename="p.pdf", stored_path="storage/past_research/p.pdf",
        file_size=100, status="pending",
        submitted_by_student_id=student_user.id,
        supervisor_id=teacher_user.id,
    ))
    await db_session.commit()

    r = await app_client.get(
        "/api/past-research/_my/pending", headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "pending mine"
