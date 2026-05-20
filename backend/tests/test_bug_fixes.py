"""버그 fix 회귀 테스트 — 코드 리뷰에서 발견된 문제들.

검증:
  - delegation: 부장이 다른 부서 사용자의 권한 회수 차단
  - lifecycle: 비활성/만료 사용자에게 자료 이관 차단
  - course_seed: 졸업·전학 학생은 학급 강좌 자동 등록에서 제외
  - customize: clear_banner_image 시 파일 삭제 + quota 환원
  - google OAuth: state TTL 만료, user_id 평문 노출 차단
  - storage: 같은 경로 중복 등록 차단
"""

import os
from datetime import date, datetime, timedelta, timezone
from io import BytesIO

import pytest
from sqlalchemy import select

from app.models import (
    ClassroomDocument, Course, CourseStudent, Department, Semester, StorageVolume, User,
)
from app.models.permission import Permission, UserPermission
from app.modules.users.lifecycle import transfer_ownership  # noqa: F401 — import 검증


# ── delegation: cross-department revoke 차단 ─────────────────


@pytest.mark.asyncio
async def test_lead_cannot_revoke_other_dept_user_permission(
    app_client, db_session, teacher_user, auth_headers,
):
    """부서 A의 부장이 부서 B 사용자의 권한을 회수할 수 없어야 한다."""
    from tests.conftest import _create_user

    other = await _create_user(
        db_session, email="otherdept@test.local", name="Other Dept Member", role="teacher",
    )

    # 부서 A: teacher_user가 부장, 본인은 멤버
    dept_a = Department(name="부서A", lead_user_id=teacher_user.id)
    db_session.add(dept_a)
    await db_session.flush()
    teacher_user.department_id = dept_a.id

    # 부서 B: other는 부서 B 소속 (부장 없음)
    dept_b = Department(name="부서B")
    db_session.add(dept_b)
    await db_session.flush()
    other.department_id = dept_b.id

    # other에게 권한 부여 (직접 DB)
    perm = (await db_session.execute(
        select(Permission).where(Permission.key == "classroom.course.view")
    )).scalar_one_or_none()
    db_session.add(UserPermission(
        user_id=other.id, permission_id=perm.id, granted_by=teacher_user.id,
    ))
    await db_session.commit()

    # 부서 A 부장(teacher_user)이 부서 B 멤버(other)의 권한 회수 시도 → 403
    r = await app_client.delete(
        f"/api/departments/{dept_a.id}/delegations/{other.id}/classroom.course.view",
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_revoke_any_dept_permission(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    """admin은 cross-department도 가능."""
    dept = Department(name="부서C")
    db_session.add(dept)
    await db_session.flush()
    teacher_user.department_id = dept.id

    perm = (await db_session.execute(
        select(Permission).where(Permission.key == "classroom.course.view")
    )).scalar_one_or_none()
    db_session.add(UserPermission(
        user_id=teacher_user.id, permission_id=perm.id, granted_by=super_admin.id,
    ))
    await db_session.commit()

    r = await app_client.delete(
        f"/api/departments/{dept.id}/delegations/{teacher_user.id}/classroom.course.view",
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200


# ── lifecycle: successor disabled / departed 차단 ──────────


@pytest.mark.asyncio
async def test_transfer_ownership_to_disabled_user_blocked(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    from tests.conftest import _create_user
    disabled_successor = await _create_user(
        db_session, email="dis@test.local", name="Disabled", role="teacher",
    )
    disabled_successor.status = "disabled"
    await db_session.commit()

    r = await app_client.post(
        f"/api/users/{teacher_user.id}/transfer-ownership",
        json={"successor_user_id": disabled_successor.id, "types": ["docs"]},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400
    assert "비활성화" in r.json().get("detail", "")


@pytest.mark.asyncio
async def test_transfer_ownership_to_departed_user_blocked(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    from tests.conftest import _create_user
    departed_successor = await _create_user(
        db_session, email="dep@test.local", name="Departed", role="teacher",
    )
    departed_successor.lifecycle_status = "departed"
    await db_session.commit()

    r = await app_client.post(
        f"/api/users/{teacher_user.id}/transfer-ownership",
        json={"successor_user_id": departed_successor.id, "types": ["docs"]},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400


# ── course_seed: 졸업·전학 학생 제외 ──────────────────────


@pytest.mark.asyncio
async def test_class_homeroom_seed_excludes_graduated_students(
    app_client, db_session, super_admin, teacher_user, auth_headers,
):
    """학급 강좌 자동 생성 시 lifecycle_status != active 학생은 등록 안 됨."""
    from tests.conftest import _create_user

    sem = Semester(
        name="2026-1", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    # 담임 enrollment (homeroom_class="3-1")
    from app.models import SemesterEnrollment
    db_session.add(SemesterEnrollment(
        semester_id=sem.id, user_id=teacher_user.id, role="teacher", homeroom_class="3-1",
    ))

    # active 학생 1명
    active_st = await _create_user(
        db_session, email="active_st@test.local", name="Active Student",
        role="student", grade=3, class_number=1, student_number=1,
    )
    # graduated 학생 1명 (같은 학급)
    grad_st = await _create_user(
        db_session, email="grad_st@test.local", name="Grad Student",
        role="student", grade=3, class_number=1, student_number=2,
    )
    grad_st.lifecycle_status = "graduated"
    await db_session.commit()

    r = await app_client.post(
        "/api/classroom/courses/_seed-auto",
        json={"semester_id": sem.id, "grade_office": False, "class_homeroom": True},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 200
    assert r.json()["total_created"] == 1

    # 새로 생성된 학급 강좌
    course = (await db_session.execute(
        select(Course).where(
            Course.semester_id == sem.id,
            Course.course_type == "class_homeroom",
        )
    )).scalar_one_or_none()
    assert course is not None

    # 학생 자동 등록: active만, graduated 제외
    enrolled = (await db_session.execute(
        select(CourseStudent).where(CourseStudent.course_id == course.id)
    )).scalars().all()
    enrolled_ids = {cs.student_id for cs in enrolled}
    assert active_st.id in enrolled_ids
    assert grad_st.id not in enrolled_ids


# ── customize: clear_banner_image cleanup ────────────────


@pytest.mark.asyncio
async def test_clear_banner_image_releases_quota(
    app_client, db_session, teacher_user, auth_headers, tmp_path, monkeypatch,
):
    """clear_banner_image=True 시 파일 삭제 + quota 환원."""
    # BANNER_DIR을 tmp_path로 redirect
    from app.modules.classroom import customize as cz
    monkeypatch.setattr(cz, "BANNER_DIR", str(tmp_path))

    sem = Semester(
        name="2026-1", year=2026, semester=1, is_current=True,
        start_date=date(2026, 3, 1), end_date=date(2026, 7, 31),
    )
    db_session.add(sem)
    await db_session.flush()

    course = Course(
        semester_id=sem.id, teacher_id=teacher_user.id,
        subject="수학", class_name="2-1", name="2-1 수학",
        is_active=True, course_type="subject",
    )
    db_session.add(course)
    await db_session.flush()

    # 파일 생성 + 메타 세팅
    fname = "test_banner.jpg"
    fpath = tmp_path / fname
    fpath.write_bytes(b"x" * 10_000)  # 10KB
    course.banner_image_url = f"/storage/classroom/banners/{fname}"
    teacher_user.used_bytes = 10_000
    await db_session.commit()

    initial_used = teacher_user.used_bytes

    # clear 호출
    r = await app_client.patch(
        f"/api/classroom/courses/{course.id}/customize",
        json={"clear_banner_image": True},
        headers=auth_headers(teacher_user),
    )
    assert r.status_code == 200

    # 파일 삭제됨
    assert not fpath.exists()

    # quota 환원
    await db_session.refresh(teacher_user)
    assert teacher_user.used_bytes == initial_used - 10_000


# ── google OAuth: state TTL ──────────────────────────────


@pytest.mark.asyncio
async def test_oauth_state_expired_rejected(
    app_client, db_session, teacher_user, auth_headers,
):
    """state가 10분 초과되면 callback 거부."""
    from app.modules.google_integration.router import STATE_TTL_SECONDS

    # OAuth 설정 (mock)
    from app.modules.system.router import router as system_router  # noqa
    from app.models.setting import SchoolConfig
    from app.core.encryption import encrypt

    db_session.add(SchoolConfig(key="oauth.google.client_id", value=encrypt("cid"), encrypted=True))
    db_session.add(SchoolConfig(key="oauth.google.client_secret", value=encrypt("cs"), encrypted=True))
    db_session.add(SchoolConfig(key="oauth.google.redirect_uri", value="https://x/cb", encrypted=False))
    db_session.add(SchoolConfig(key="oauth.google.enabled", value="true", encrypted=False))
    # 만료된 state 직접 삽입
    expired_ts = int((datetime.now(timezone.utc) - timedelta(seconds=STATE_TTL_SECONDS + 60)).timestamp())
    db_session.add(SchoolConfig(
        key="oauth.google.state.EXPIRED_STATE",
        value=f"{teacher_user.id}|{expired_ts}",
        encrypted=False,
    ))
    await db_session.commit()

    r = await app_client.get("/api/google/callback?code=x&state=EXPIRED_STATE")
    assert r.status_code == 400
    assert "만료" in r.json().get("detail", "")


@pytest.mark.asyncio
async def test_oauth_invalid_state_rejected(app_client):
    """존재하지 않는 state 거부."""
    r = await app_client.get("/api/google/callback?code=x&state=NONEXISTENT")
    assert r.status_code == 400


# ── storage: path 중복 차단 ──────────────────────────────


@pytest.mark.asyncio
async def test_storage_duplicate_path_rejected(
    app_client, super_admin, auth_headers, tmp_path,
):
    """같은 경로를 두 볼륨에 등록 차단 (정규화 후 비교)."""
    p = str(tmp_path)

    r1 = await app_client.post(
        "/api/storage/volumes",
        json={"name": "vol1", "path": p, "capacity_bytes": 1_000_000},
        headers=auth_headers(super_admin),
    )
    assert r1.status_code == 200

    # 같은 path, 다른 name → 409
    r2 = await app_client.post(
        "/api/storage/volumes",
        json={"name": "vol2", "path": p, "capacity_bytes": 1_000_000},
        headers=auth_headers(super_admin),
    )
    assert r2.status_code == 409

    # 끝 슬래시 포함된 다른 표기 → 정규화 후 같은 path → 409
    r3 = await app_client.post(
        "/api/storage/volumes",
        json={"name": "vol3", "path": p + "/", "capacity_bytes": 1_000_000},
        headers=auth_headers(super_admin),
    )
    assert r3.status_code == 409


@pytest.mark.asyncio
async def test_storage_missing_path_rejected(
    app_client, super_admin, auth_headers,
):
    r = await app_client.post(
        "/api/storage/volumes",
        json={"name": "missing", "path": "/this/does/not/exist/12345"},
        headers=auth_headers(super_admin),
    )
    assert r.status_code == 400
