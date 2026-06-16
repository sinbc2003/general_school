"""연구 심사 워크플로 회귀 테스트 — 일지/제출물 피드백·승인.

검증:
  - 교사: 학생 일지(journal) 피드백 작성 → list_journals에 반영
  - 교사: 산출물 승인/반려 + 코멘트 → list_submissions에 반영 + file_url 노출
  - 학생: 심사(PATCH) 불가 → 403 (research.project.review 미보유)
"""

import pytest
import pytest_asyncio

from app.models.research import (
    ResearchJournal, ResearchLog, ResearchProject, ResearchSubmission,
)
from tests.conftest import _create_user


@pytest_asyncio.fixture
async def rr_setup(db_session, teacher_user):
    student = await _create_user(
        db_session, email="rr_stu@test.local", name="연구학생", role="student",
    )
    proj = ResearchProject(
        title="R&E 1", research_type="rne", year=2026,
        advisor_id=teacher_user.id, created_by_id=teacher_user.id,
    )
    db_session.add(proj)
    await db_session.flush()
    journal = ResearchJournal(
        project_id=proj.id, author_id=student.id, content="1주차 활동", week_number=1,
    )
    log = ResearchLog(
        project_id=proj.id, author_id=teacher_user.id,
        title="지도 기록", content="진행 점검", log_type="progress",
    )
    sub = ResearchSubmission(
        project_id=proj.id, title="중간보고서", submission_type="report",
        filename="report.pdf", stored_path="storage/research/abc.pdf",
        file_size=1234, submitted_by_id=student.id,
    )
    db_session.add_all([journal, log, sub])
    await db_session.commit()
    return {"proj": proj, "student": student, "journal": journal, "log": log, "sub": sub}


@pytest.mark.asyncio
async def test_teacher_sets_journal_feedback(app_client, auth_headers, teacher_user, rr_setup):
    jid = rr_setup["journal"].id
    r = await app_client.patch(
        f"/api/research/journals/{jid}/feedback",
        json={"feedback": "잘했어요"}, headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    lr = await app_client.get(
        f"/api/research/{rr_setup['proj'].id}/journals", headers=auth_headers(teacher_user),
    )
    assert lr.status_code == 200
    assert lr.json()[0]["feedback"] == "잘했어요"


@pytest.mark.asyncio
async def test_teacher_reviews_submission(app_client, auth_headers, teacher_user, rr_setup):
    sid = rr_setup["sub"].id
    r = await app_client.patch(
        f"/api/research/submissions/{sid}/review",
        json={"review_status": "approved", "review_comment": "통과"},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text
    lr = await app_client.get(
        f"/api/research/{rr_setup['proj'].id}/submissions", headers=auth_headers(teacher_user),
    )
    s0 = lr.json()[0]
    assert s0["review_status"] == "approved"
    assert s0["review_comment"] == "통과"
    assert s0["file_url"] == "/storage/research/abc.pdf"


@pytest.mark.asyncio
async def test_teacher_sets_log_feedback(app_client, auth_headers, teacher_user, rr_setup):
    lid = rr_setup["log"].id
    r = await app_client.patch(
        f"/api/research/logs/{lid}/feedback",
        json={"feedback": "보완 필요"}, headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_student_cannot_review(app_client, auth_headers, rr_setup):
    sid = rr_setup["sub"].id
    r = await app_client.patch(
        f"/api/research/submissions/{sid}/review",
        json={"review_status": "approved"}, headers=auth_headers(rr_setup["student"]),
    )
    assert r.status_code == 403
