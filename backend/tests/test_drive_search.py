"""드라이브 통합 검색 테스트.

검증:
  - 제목 / 본문(plain_text) / 폴더 이름 검색
  - 본인 자료만 (IDOR)
  - 휴지통 제외 (include_trash=false 기본)
  - 빈 쿼리 / 너무 짧은 쿼리 거부
"""

from __future__ import annotations

import pytest

from app.models import (
    ClassroomDocument, ClassroomHwp, ClassroomPresentation,
    ClassroomSheet, ClassroomSlide, Folder,
)


@pytest.mark.asyncio
async def test_search_by_title(
    app_client, db_session, teacher_user, auth_headers,
):
    db_session.add_all([
        ClassroomDocument(owner_id=teacher_user.id, title="회의록 회의 1차"),
        ClassroomDocument(owner_id=teacher_user.id, title="평가 루브릭"),
        ClassroomSheet(owner_id=teacher_user.id, title="회의 출석부"),
    ])
    await db_session.commit()

    r = await app_client.get(
        "/api/drive/search?q=회의",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    data = r.json()
    titles = [it["title"] for it in data["items"]]
    assert "회의록 회의 1차" in titles
    assert "회의 출석부" in titles
    assert "평가 루브릭" not in titles


@pytest.mark.asyncio
async def test_search_by_body_plain_text(
    app_client, db_session, teacher_user, auth_headers,
):
    db_session.add_all([
        ClassroomDocument(
            owner_id=teacher_user.id, title="A 문서",
            plain_text="중간고사 출제 범위 안내",
        ),
        ClassroomDocument(
            owner_id=teacher_user.id, title="B 문서",
            plain_text="다른 내용",
        ),
    ])
    await db_session.commit()

    r = await app_client.get(
        "/api/drive/search?q=중간고사",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    data = r.json()
    titles = [it["title"] for it in data["items"]]
    assert "A 문서" in titles
    assert "B 문서" not in titles
    a_match = next(it for it in data["items"] if it["title"] == "A 문서")
    assert a_match["match_field"] == "body"
    assert "중간고사" in (a_match["snippet"] or "")


@pytest.mark.asyncio
async def test_search_folders(
    app_client, db_session, teacher_user, auth_headers,
):
    db_session.add_all([
        Folder(owner_id=teacher_user.id, name="2026 교무부", sort_order=1),
        Folder(owner_id=teacher_user.id, name="수업 자료", sort_order=2),
    ])
    await db_session.commit()

    r = await app_client.get(
        "/api/drive/search?q=교무",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    data = r.json()
    folder_names = [f["name"] for f in data["folders"]]
    assert "2026 교무부" in folder_names
    assert "수업 자료" not in folder_names


@pytest.mark.security
@pytest.mark.asyncio
async def test_search_only_own_items(
    app_client, db_session, teacher_user, student_user, auth_headers,
):
    """다른 사용자 자료는 검색 결과에 안 들어감."""
    db_session.add_all([
        ClassroomDocument(owner_id=teacher_user.id, title="교사 비밀 문서"),
        ClassroomDocument(owner_id=student_user.id, title="비밀 학생 일기"),
    ])
    await db_session.commit()

    # 학생이 "비밀" 검색 → 본인 일기만
    r = await app_client.get(
        "/api/drive/search?q=비밀",
        headers=auth_headers(student_user),
    )
    assert r.status_code == 200
    titles = [it["title"] for it in r.json()["items"]]
    assert "비밀 학생 일기" in titles
    assert "교사 비밀 문서" not in titles


@pytest.mark.asyncio
async def test_search_excludes_trash_by_default(
    app_client, db_session, teacher_user, auth_headers,
):
    from datetime import datetime, timezone
    db_session.add_all([
        ClassroomDocument(owner_id=teacher_user.id, title="활성 회의록"),
        ClassroomDocument(
            owner_id=teacher_user.id, title="삭제된 회의록",
            deleted_at=datetime.now(timezone.utc),
        ),
    ])
    await db_session.commit()

    r = await app_client.get(
        "/api/drive/search?q=회의록",
        headers=auth_headers(teacher_user),
    )
    titles = [it["title"] for it in r.json()["items"]]
    assert "활성 회의록" in titles
    assert "삭제된 회의록" not in titles

    # 휴지통 포함
    r2 = await app_client.get(
        "/api/drive/search?q=회의록&include_trash=true",
        headers=auth_headers(teacher_user),
    )
    titles2 = [it["title"] for it in r2.json()["items"]]
    assert "삭제된 회의록" in titles2


@pytest.mark.asyncio
async def test_search_rejects_empty_query(
    app_client, teacher_user, auth_headers,
):
    """빈 쿼리 거부 — fastapi validation."""
    r = await app_client.get(
        "/api/drive/search?q=",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 422  # FastAPI Query(min_length=1)


@pytest.mark.asyncio
async def test_search_survey_question_text(
    app_client, db_session, teacher_user, auth_headers,
):
    """설문지 질문 본문도 검색."""
    from app.models import Survey, SurveyQuestion
    sv = Survey(author_id=teacher_user.id, title="만족도", status="active", access_mode="course_members")
    db_session.add(sv)
    await db_session.flush()
    db_session.add(SurveyQuestion(
        survey_id=sv.id, order=0, question_type="short_text",
        question_text="진로희망 직업이 무엇입니까?",
    ))
    await db_session.commit()

    r = await app_client.get(
        "/api/drive/search?q=진로희망",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    survey_match = next((it for it in items if it["type"] == "surveys"), None)
    assert survey_match is not None
    assert survey_match["match_field"] == "question"
