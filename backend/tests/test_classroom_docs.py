"""클래스룸 협업 문서(classroom_docs) 보안·권한 테스트.

핵심 회귀 시나리오:
1. Hocuspocus snapshot endpoint는 X-Internal-Token 검증 필수
   (틀리거나 미설정 시 401/503 — 임의 외부인이 yjs_state 덮어쓰기 차단)
2. 강좌 비멤버는 문서 조회 403 (access_mode=course_members)
3. 강좌 학생은 문서 편집 가능 (Google Docs 식 동시 편집)
4. 강좌 외 학생은 403, can_read=False
5. owner는 항상 read+write+share
6. 보관(is_archived) 시 write 거부

회귀 위험:
- 누군가 snapshot endpoint의 token 검증을 제거하면 fail
- _resolve_permission의 강좌 멤버 가드를 깨면 fail
- archived 문서 write 차단을 풀면 fail
"""

import base64

import pytest
import pytest_asyncio

from app.core.config import settings
from app.models.classroom import Course, CourseStudent
from app.models.classroom_docs import (
    ClassroomDocument, DocumentMember, DocumentRevision,
)
from app.models.timetable import Semester


pytestmark = pytest.mark.security


# ── helpers ────────────────────────────────────────────────


@pytest_asyncio.fixture
async def semester(db_session):
    """테스트용 학기."""
    from datetime import date
    s = Semester(
        year=2026, semester=1, name="2026-1", is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 20),
    )
    db_session.add(s)
    await db_session.flush()
    return s


@pytest_asyncio.fixture
async def other_student(db_session, seed_perms):
    """강좌 비멤버 학생."""
    from tests.conftest import _create_user
    return await _create_user(
        db_session, email="other@test.local", name="Other Student",
        role="student", grade=2, class_number=3, student_number=99,
    )


@pytest_asyncio.fixture
async def course(db_session, semester, teacher_user):
    c = Course(
        semester_id=semester.id,
        teacher_id=teacher_user.id,
        subject="수학",
        class_name="2-3",
        name="2-3 수학",
    )
    db_session.add(c)
    await db_session.flush()
    return c


@pytest_asyncio.fixture
async def enrolled_student(db_session, course, student_user):
    """course에 active로 등록된 student_user."""
    cs = CourseStudent(course_id=course.id, student_id=student_user.id, status="active")
    db_session.add(cs)
    await db_session.flush()
    return cs


@pytest_asyncio.fixture
async def doc(db_session, course, teacher_user):
    d = ClassroomDocument(
        course_id=course.id,
        owner_id=teacher_user.id,
        title="실습 문서",
        access_mode="course_members",
    )
    db_session.add(d)
    await db_session.flush()
    return d


# ── snapshot endpoint (Hocuspocus 전용 — INTERNAL_TOKEN 인증) ──


@pytest.mark.asyncio
async def test_snapshot_post_requires_internal_token(app_client, doc, monkeypatch):
    """X-Internal-Token 없으면 401."""
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "test-token")
    state = base64.b64encode(b"fake yjs state").decode("ascii")
    res = await app_client.post(
        f"/api/classroom/docs/{doc.id}/yjs-snapshot",
        json={"state_base64": state},
    )
    assert res.status_code == 401, "X-Internal-Token 미전송 시 401 필요"


@pytest.mark.asyncio
async def test_snapshot_post_rejects_wrong_token(app_client, doc, monkeypatch):
    """잘못된 X-Internal-Token이면 401."""
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "expected-token")
    state = base64.b64encode(b"fake yjs state").decode("ascii")
    res = await app_client.post(
        f"/api/classroom/docs/{doc.id}/yjs-snapshot",
        json={"state_base64": state},
        headers={"X-Internal-Token": "wrong-token"},
    )
    assert res.status_code == 401, "잘못된 토큰 시 401 필요"


@pytest.mark.asyncio
async def test_snapshot_post_503_when_token_unset(app_client, doc, monkeypatch):
    """HOCUSPOCUS_INTERNAL_TOKEN env가 비어있으면 503 (서비스 미구성)."""
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "")
    state = base64.b64encode(b"x").decode("ascii")
    res = await app_client.post(
        f"/api/classroom/docs/{doc.id}/yjs-snapshot",
        json={"state_base64": state},
        headers={"X-Internal-Token": "any-token"},
    )
    assert res.status_code == 503


@pytest.mark.asyncio
async def test_snapshot_post_persists_state_and_revision(
    app_client, db_session, doc, monkeypatch,
):
    """올바른 토큰으로 POST하면 yjs_state 갱신 + DocumentRevision 1건 추가."""
    monkeypatch.setattr(settings, "HOCUSPOCUS_INTERNAL_TOKEN", "ok-token")
    payload_bytes = b"binary yjs state v1"
    state_b64 = base64.b64encode(payload_bytes).decode("ascii")

    res = await app_client.post(
        f"/api/classroom/docs/{doc.id}/yjs-snapshot",
        json={"state_base64": state_b64, "plain_text": "hello"},
        headers={"X-Internal-Token": "ok-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["byte_size"] == len(payload_bytes)
    assert body["revision_id"] >= 1


# ── permission 가드 ──────────────────────────────────────


@pytest.mark.asyncio
async def test_other_student_cannot_read_course_doc(
    app_client, doc, other_student, auth_headers,
):
    """강좌 비멤버 학생은 course_members 모드 문서 403."""
    res = await app_client.get(
        f"/api/classroom/docs/{doc.id}",
        headers=auth_headers(other_student),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_enrolled_student_can_read_and_write(
    app_client, doc, enrolled_student, student_user, auth_headers,
):
    """강좌 학생은 course_members 모드 문서 read+write (Google Docs 식)."""
    res = await app_client.get(
        f"/api/classroom/docs/{doc.id}",
        headers=auth_headers(student_user),
    )
    assert res.status_code == 200
    perm = res.json()["permission"]
    assert perm["can_read"] is True
    assert perm["can_write"] is True
    assert perm["can_share"] is False  # 학생은 share 불가
    assert perm["role"] == "editor"


@pytest.mark.asyncio
async def test_owner_has_full_permission(
    app_client, doc, teacher_user, auth_headers,
):
    """소유자는 항상 read+write+share."""
    res = await app_client.get(
        f"/api/classroom/docs/{doc.id}",
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200
    perm = res.json()["permission"]
    assert perm == {
        "can_read": True, "can_write": True, "can_share": True, "role": "owner",
    }


@pytest.mark.asyncio
async def test_archived_doc_blocks_write_via_permission_endpoint(
    app_client, db_session, doc, teacher_user, auth_headers,
):
    """is_archived=True면 permission endpoint가 can_write=False 강제 (Hocuspocus 가드)."""
    doc.is_archived = True
    await db_session.flush()

    res = await app_client.get(
        f"/api/classroom/docs/{doc.id}/permission",
        headers=auth_headers(teacher_user),
    )
    assert res.status_code == 200
    perm = res.json()
    assert perm["can_read"] is True
    assert perm["can_write"] is False, "보관된 문서는 모든 사용자 read-only"


@pytest.mark.asyncio
async def test_yjs_snapshot_get_requires_read_permission(
    app_client, doc, other_student, auth_headers,
):
    """다른 학생은 yjs-snapshot 조회 403."""
    res = await app_client.get(
        f"/api/classroom/docs/{doc.id}/yjs-snapshot",
        headers=auth_headers(other_student),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_create_doc(
    app_client, course, student_user, auth_headers,
):
    """학생은 classroom.doc.create 권한 없음 — 생성 시도 403."""
    res = await app_client.post(
        "/api/classroom/docs",
        json={"title": "학생이 만들려는 문서", "course_id": course.id},
        headers=auth_headers(student_user),
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_unauthorized_user_cannot_share(
    app_client, doc, enrolled_student, student_user, auth_headers,
):
    """학생(non-owner)은 멤버 추가/제거 403."""
    res = await app_client.post(
        f"/api/classroom/docs/{doc.id}/members",
        json={"user_id": student_user.id, "role": "editor"},
        headers=auth_headers(student_user),
    )
    # 학생은 doc.share 권한 자체가 없어 require_permission 단계에서 403
    assert res.status_code == 403
