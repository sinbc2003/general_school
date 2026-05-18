"""권한 시스템 핵심 테스트.

권한 변경은 보안 critical — 회귀 발생 시 권한 상승 위험.
이 테스트가 깨지면 절대 배포 금지.
"""

import pytest

pytestmark = [pytest.mark.permissions, pytest.mark.security]


# ── resolve_permissions ────────────────────────────────────

async def test_super_admin_has_all_permissions(db_session, super_admin):
    """super_admin은 모든 권한 키를 자동 보유."""
    from app.core.permissions import resolve_permissions
    from app.models.permission import Permission
    from sqlalchemy import select

    perms = await resolve_permissions(db_session, super_admin)
    all_keys = set(
        (await db_session.execute(select(Permission.key))).scalars().all()
    )
    assert perms == all_keys
    assert len(perms) > 0


async def test_designated_admin_excludes_super_admin_only(db_session, designated_admin):
    """designated_admin은 SUPER_ADMIN_ONLY 키를 제외한 모든 권한 보유 (full 모드)."""
    from app.core.permissions import resolve_permissions, SUPER_ADMIN_ONLY_KEYS

    perms = await resolve_permissions(db_session, designated_admin)
    # SUPER_ADMIN_ONLY 키는 단 하나도 포함 안 됨
    assert perms.isdisjoint(SUPER_ADMIN_ONLY_KEYS), \
        f"designated_admin이 SUPER_ADMIN_ONLY 권한을 가짐: {perms & SUPER_ADMIN_ONLY_KEYS}"


async def test_teacher_has_default_role_permissions(db_session, teacher_user):
    """teacher는 grant_default_roles 디폴트 권한 보유. user.manage.view 포함,
    user.manage.edit 등은 차단 (권한 상승 방어).

    seed_perms fixture가 grant_default_roles까지 자동 적용 (운영과 동일 상태).
    """
    from app.core.permissions import resolve_permissions

    perms = await resolve_permissions(db_session, teacher_user)
    # user.manage.view는 화이트리스트로 포함
    assert "user.manage.view" in perms, \
        "user.manage.view는 TEACHER_INCLUDE_KEYS에 의해 teacher에 부여돼야 함"
    # user.manage.edit는 prefix 차단 → teacher가 가질 수 없음 (권한 상승 차단)
    assert "user.manage.edit" not in perms, \
        "🔴 보안 회귀: teacher가 user.manage.edit 권한 보유 (권한 상승 가능)"
    assert "user.manage.delete" not in perms
    # system 도 차단
    assert "system.backup.manage" not in perms


# ── designated_admin scoped/full 모드 ─────────────────────

async def test_designated_admin_scoped_mode_restricts_permissions(
    db_session, designated_admin,
):
    """scoped 모드 + role_permissions 비어있으면 designated_admin도 거의 권한 없음."""
    from app.core.permissions import (
        set_designated_admin_mode, resolve_permissions,
    )
    await set_designated_admin_mode(db_session, "scoped")
    await db_session.commit()

    perms = await resolve_permissions(db_session, designated_admin)
    # scoped 모드 + role_permissions 미설정 → 거의 빈 set
    assert len(perms) < 5, \
        f"scoped 모드에서 designated_admin이 기대 외 권한 보유: {perms}"


# ── require_permission decorator ──────────────────────────

async def test_require_permission_blocks_without_permission(
    app_client, student_user, auth_headers,
):
    """학생이 admin endpoint 호출 시 403."""
    headers = auth_headers(student_user)
    resp = await app_client.get("/api/users", headers=headers)
    assert resp.status_code == 403


async def test_super_admin_bypasses_require_permission(
    app_client, super_admin, auth_headers,
):
    """super_admin은 어떤 require_permission도 통과."""
    headers = auth_headers(super_admin)
    resp = await app_client.get("/api/users", headers=headers)
    assert resp.status_code == 200


# ── 학기 직책 권한 ────────────────────────────────────────

async def test_position_template_permissions_applied_to_enrollment(
    db_session, teacher_user,
):
    """학기 직책 부여 시 resolve_permissions가 그 권한을 포함."""
    import json
    from datetime import date
    from app.core.permissions import resolve_permissions
    from app.models.timetable import Semester, SemesterEnrollment
    from app.models.position import PositionTemplate, EnrollmentPosition

    # 1) 현재 학기 생성
    sem = Semester(
        year=2026, semester=1, name="2026-1",
        start_date=date(2026, 3, 1), end_date=date(2026, 8, 31),
        is_current=True,
    )
    db_session.add(sem)
    await db_session.flush()

    # 2) enrollment
    enr = SemesterEnrollment(
        semester_id=sem.id, user_id=teacher_user.id, role="teacher", status="active",
    )
    db_session.add(enr)
    await db_session.flush()

    # 3) 직책 템플릿 — assignment.submit.view 부여
    tpl = PositionTemplate(
        key="test_homeroom", display_name="테스트 담임", category="테스트",
        permission_keys=json.dumps(["chatbot.usage.view_all"]),
    )
    db_session.add(tpl)
    await db_session.flush()

    # 4) 직책 할당
    db_session.add(EnrollmentPosition(
        enrollment_id=enr.id, position_template_id=tpl.id,
    ))
    await db_session.commit()

    # 5) 권한 해석 → 직책의 권한이 포함되어야 함
    perms = await resolve_permissions(db_session, teacher_user)
    assert "chatbot.usage.view_all" in perms, \
        "학기 직책 권한이 resolve_permissions에 반영되지 않음"


async def test_position_permissions_isolated_to_current_semester(
    db_session, teacher_user,
):
    """현재 학기가 아닌 enrollment의 직책 권한은 부여되지 않음."""
    import json
    from datetime import date
    from app.core.permissions import resolve_permissions
    from app.models.timetable import Semester, SemesterEnrollment
    from app.models.position import PositionTemplate, EnrollmentPosition

    # 1) 과거 학기 (is_current=False)
    past = Semester(
        year=2025, semester=2, name="2025-2",
        start_date=date(2025, 9, 1), end_date=date(2026, 2, 28),
        is_current=False,
    )
    db_session.add(past)
    await db_session.flush()

    enr = SemesterEnrollment(
        semester_id=past.id, user_id=teacher_user.id, role="teacher", status="active",
    )
    db_session.add(enr)

    tpl = PositionTemplate(
        key="past_role", display_name="과거 직책", category="테스트",
        permission_keys=json.dumps(["chatbot.usage.view_all"]),
    )
    db_session.add(tpl)
    await db_session.flush()

    db_session.add(EnrollmentPosition(
        enrollment_id=enr.id, position_template_id=tpl.id,
    ))
    await db_session.commit()

    perms = await resolve_permissions(db_session, teacher_user)
    # 현재 학기가 없으니 직책 권한 적용 X
    assert "chatbot.usage.view_all" not in perms, \
        "과거 학기 직책 권한이 누설됨"
