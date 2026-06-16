"""합격 분석 집계 회귀 테스트 — AdmissionsRecord.results 방어적 집계."""

import pytest
import pytest_asyncio

from app.models.admissions import AdmissionsRecord
from tests.conftest import _create_user


@pytest_asyncio.fixture
async def adm_setup(db_session, teacher_user):
    s1 = await _create_user(db_session, email="adm_s1@test.local", name="졸업생1", role="student")
    s2 = await _create_user(db_session, email="adm_s2@test.local", name="졸업생2", role="student")
    db_session.add_all([
        AdmissionsRecord(student_id=s1.id, graduation_year=2025, results=[
            {"university": "서울대학교", "admission_type": "학생부종합", "result": "accepted"},
            {"university": "연세대학교", "admission_type": "학생부종합", "result": "rejected"},
        ]),
        AdmissionsRecord(student_id=s2.id, graduation_year=2025, results=[
            {"university": "서울대학교", "admission_type": "논술", "result": "rejected"},
        ]),
    ])
    await db_session.commit()
    return {}


@pytest.mark.asyncio
async def test_analysis_aggregates(app_client, auth_headers, teacher_user, adm_setup):
    r = await app_client.get("/api/admissions/analysis", headers=auth_headers(teacher_user))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total_applied"] == 3
    assert d["total_accepted"] == 1
    snu = next(u for u in d["universities"] if u["university"] == "서울대학교")
    assert snu["applied"] == 2 and snu["accepted"] == 1
    assert d["years"][0]["year"] == 2025
    # 전형별 집계
    jonghap = next(t for t in d["admission_types"] if t["admission_type"] == "학생부종합")
    assert jonghap["applied"] == 2


@pytest.mark.asyncio
async def test_analysis_empty(app_client, auth_headers, teacher_user):
    r = await app_client.get("/api/admissions/analysis", headers=auth_headers(teacher_user))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["record_count"] == 0
    assert d["total_applied"] == 0


# ── AI 대학 추천 (LLM 경로는 모델 미설정으로 400까지만 검증) ──

@pytest.mark.asyncio
async def test_recommend_student_not_found(app_client, auth_headers, teacher_user):
    r = await app_client.post(
        "/api/admissions/recommend", json={"student_id": 999999},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_recommend_requires_model(app_client, auth_headers, teacher_user, db_session):
    s = await _create_user(db_session, email="rec_s@test.local", name="추천학생", role="student")
    await db_session.commit()
    r = await app_client.post(
        "/api/admissions/recommend", json={"student_id": s.id},
        headers=auth_headers(teacher_user),
    )
    # ChatbotConfig 기본 모델 미설정/API 키 미등록 → 400
    assert r.status_code == 400
