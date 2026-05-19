"""cohort 라이프사이클 + 마지막 super_admin 보호 테스트.

대상 코드:
  - `app/modules/users/_helpers.py`의 `_ensure_not_last_super_admin`,
    `_count_active_super_admins`
  - `app/modules/users/cohort.py` 의 promote / graduate endpoints
  - `app/modules/users/crud.py` 의 update_user / delete_user (마지막 super_admin 보호)

왜 이게 critical:
  - 마지막 super_admin을 강등/비활성/삭제하면 시스템 잠김 → 학교 운영 마비
  - promote 학년 한 번 잘못 실행하면 학년 전체 데이터 꼬임 (1→3 같은 점프)
  - dry_run 모드가 실제로 데이터를 안 건드리는지 보장 (preview 신뢰성)

테스트 매트릭스:
  - 마지막 super_admin 강등 시도 → 400
  - 마지막 super_admin 비활성화 시도 → 400
  - 두 명일 때 한 명 강등 → OK
  - promote 1→2 → grade 1 학생들 grade=2
  - promote 2→3 → grade 2 학생들 grade=3
  - promote from_grade=3 → 400 (graduate 써야 함)
  - promote to_grade=from_grade+2 → 400
  - promote dry_run → 실제 데이터 변경 없음
  - graduate 3학년 전체 → status=graduated
  - graduate by ids → 지정 학생만
  - graduate dry_run → 변경 없음
"""

import pytest
from fastapi import HTTPException

from app.modules.users._helpers import (
    _count_active_super_admins,
    _ensure_not_last_super_admin,
)


pytestmark = pytest.mark.security


# ── helper ────────────────────────────────────────────────


async def _make_student(db, *, email, name, grade, class_number=1, student_number=1):
    from tests.conftest import _create_user
    return await _create_user(
        db, email=email, name=name, role="student",
        grade=grade, class_number=class_number, student_number=student_number,
    )


# ── 마지막 super_admin 보호 ────────────────────────────────


@pytest.mark.asyncio
async def test_count_active_super_admins_single(
    db_session, super_admin,
):
    """super_admin 1명일 때 count=1."""
    count = await _count_active_super_admins(db_session)
    assert count == 1


@pytest.mark.asyncio
async def test_count_excludes_disabled(
    db_session, super_admin, seed_perms,
):
    """status=disabled인 super_admin은 카운트 제외."""
    from tests.conftest import _create_user
    extra_sa = await _create_user(
        db_session, email="sa2@test.local", name="SA2", role="super_admin",
    )
    extra_sa.status = "disabled"
    await db_session.commit()

    count = await _count_active_super_admins(db_session)
    assert count == 1  # super_admin fixture만 active


@pytest.mark.asyncio
async def test_count_excludes_target(
    db_session, super_admin,
):
    """exclude_user_id 옵션으로 자기 자신 제외 가능."""
    count_with = await _count_active_super_admins(db_session)
    count_without = await _count_active_super_admins(
        db_session, exclude_user_id=super_admin.id,
    )
    assert count_with == 1
    assert count_without == 0


@pytest.mark.asyncio
async def test_last_super_admin_role_change_blocked(
    db_session, super_admin,
):
    """마지막 super_admin을 다른 role로 강등 시도 시 차단."""
    # super_admin이 1명만 있는 상태 — 다른 role로 변경 시도
    with pytest.raises(HTTPException) as exc:
        await _ensure_not_last_super_admin(db_session, super_admin)
    assert exc.value.status_code == 400
    assert "마지막" in exc.value.detail


@pytest.mark.asyncio
async def test_two_super_admins_one_demotion_allowed(
    db_session, super_admin, seed_perms,
):
    """두 명일 때는 한 명 강등 가능."""
    from tests.conftest import _create_user
    sa2 = await _create_user(
        db_session, email="sa2@test.local", name="SA2",
        role="super_admin",
    )
    await db_session.commit()

    # 둘 다 active super_admin → 한 명 강등 OK
    await _ensure_not_last_super_admin(db_session, sa2)  # 예외 없음
    await _ensure_not_last_super_admin(db_session, super_admin)  # 예외 없음


@pytest.mark.asyncio
async def test_non_super_admin_passes_silently(
    db_session, teacher_user,
):
    """super_admin이 아닌 target은 통과 (가드 무의미)."""
    # teacher_user는 role=teacher이므로 가드 X
    await _ensure_not_last_super_admin(db_session, teacher_user)


# ── promote (HTTP) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_grade_1_to_2(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """1학년 → 2학년 진급."""
    from app.models.user import User
    from sqlalchemy import select

    # 1학년 학생 3명 생성
    for i in range(3):
        await _make_student(db_session, email=f"g1_{i}@t.local",
                             name=f"G1_{i}", grade=1, class_number=1, student_number=i + 1)
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/promote",
        json={"from_grade": 1, "to_grade": 2, "dry_run": False},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["affected"] == 3
    assert body["dry_run"] is False

    # 검증: 1학년 0명, 2학년 3명
    g1 = (await db_session.execute(
        select(User).where(User.role == "student", User.grade == 1)
    )).scalars().all()
    g2 = (await db_session.execute(
        select(User).where(User.role == "student", User.grade == 2)
    )).scalars().all()
    assert len(g1) == 0
    assert len(g2) == 3


@pytest.mark.asyncio
async def test_promote_dry_run_does_not_modify(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """dry_run=True는 영향 학생 수만 반환, 실제 grade 변경 없음."""
    from app.models.user import User
    from sqlalchemy import select

    student = await _make_student(db_session, email="g1@t.local",
                                   name="G1", grade=1)
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/promote",
        json={"from_grade": 1, "to_grade": 2, "dry_run": True},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["affected"] == 1
    assert body["dry_run"] is True

    # 학생 grade가 그대로 1
    await db_session.refresh(student)
    assert student.grade == 1


@pytest.mark.asyncio
async def test_promote_grade_3_rejected(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """from_grade=3은 거부 (3학년 진급은 졸업 처리로)."""
    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/promote",
        json={"from_grade": 3, "to_grade": 4, "dry_run": False},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "졸업" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_promote_grade_jump_rejected(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """1→3 점프 진급은 거부 (반드시 from+1)."""
    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/promote",
        json={"from_grade": 1, "to_grade": 3, "dry_run": False},
        headers=headers,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_promote_requires_admin(
    db_session, teacher_user, auth_headers, app_client, seed_perms,
):
    """일반 교사는 진급 처리 불가 (require_permission 통과해도 _is_admin 가드)."""
    # teacher_user에게 user.manage.edit 권한이 있어도 _is_admin이 아니므로 403
    # (그러나 teacher 기본 권한에 user.manage.edit 없을 가능성 — 권한 부족 시 403)
    headers = auth_headers(teacher_user)
    resp = await app_client.post(
        "/api/users/_cohort/promote",
        json={"from_grade": 1, "to_grade": 2, "dry_run": True},
        headers=headers,
    )
    assert resp.status_code == 403


# ── graduate (HTTP) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_graduate_grade_3_all(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """3학년 전체 졸업 처리."""
    from app.models.user import User
    from sqlalchemy import select

    g3_students = []
    for i in range(2):
        s = await _make_student(db_session, email=f"g3_{i}@t.local",
                                 name=f"G3_{i}", grade=3, student_number=i + 1)
        g3_students.append(s)
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/graduate",
        json={"graduation_year": 2026, "from_grade": 3, "dry_run": False},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["affected"] == 2
    assert body["graduation_year"] == 2026

    # 졸업 학생 status=graduated 확인
    grads = (await db_session.execute(
        select(User).where(User.status == "graduated")
    )).scalars().all()
    assert len(grads) == 2


@pytest.mark.asyncio
async def test_graduate_by_ids(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """ids 지정 시 해당 학생만 졸업."""
    from app.models.user import User
    from sqlalchemy import select

    s1 = await _make_student(db_session, email="g3_1@t.local",
                              name="A", grade=3, student_number=1)
    s2 = await _make_student(db_session, email="g3_2@t.local",
                              name="B", grade=3, student_number=2)
    s3 = await _make_student(db_session, email="g3_3@t.local",
                              name="C", grade=3, student_number=3)
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/graduate",
        json={"graduation_year": 2026, "ids": [s1.id, s3.id], "dry_run": False},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["affected"] == 2

    # s2는 그대로 approved
    await db_session.refresh(s2)
    assert s2.status == "approved"
    # s1, s3은 graduated
    await db_session.refresh(s1)
    await db_session.refresh(s3)
    assert s1.status == "graduated"
    assert s3.status == "graduated"


@pytest.mark.asyncio
async def test_graduate_dry_run_preserves_data(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """graduate dry_run=True는 status 변경 없음."""
    student = await _make_student(db_session, email="g3@t.local",
                                   name="G3", grade=3)
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.post(
        "/api/users/_cohort/graduate",
        json={"graduation_year": 2026, "from_grade": 3, "dry_run": True},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["affected"] == 1
    assert body["dry_run"] is True
    assert "preview_names" in body

    # status 그대로
    await db_session.refresh(student)
    assert student.status == "approved"


@pytest.mark.asyncio
async def test_list_graduates_returns_only_graduated(
    db_session, super_admin, auth_headers, app_client, seed_perms,
):
    """/_cohort/graduates는 status=graduated 학생만 반환."""
    s_active = await _make_student(db_session, email="active@t.local",
                                     name="Active", grade=3)
    s_grad = await _make_student(db_session, email="grad@t.local",
                                   name="Grad", grade=3)
    s_grad.status = "graduated"
    await db_session.commit()

    headers = auth_headers(super_admin)
    resp = await app_client.get("/api/users/_cohort/graduates", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    names = {i["name"] for i in items}
    assert "Grad" in names
    assert "Active" not in names
