"""학생 데이터 접근 가시성(visibility) 정책 테스트.

`app/core/visibility.py`의 `assert_can_view_student` + `visible_student_user_ids`를
직접 호출해 검증한다.

왜 이게 critical:
  - 잘못하면 다른 반 학생 개인정보가 새어나간다 (성적·상담·생기부 등)
  - 정책은 Setting 테이블 키 `teacher_view_scope`로 토글 (all|scoped)
  - 교사 enrollment의 homeroom/subhomeroom/teaching_grades/teaching_classes로 매칭

테스트 매트릭스:
  - super_admin / designated_admin → 무제한 (정책 무관)
  - student → 본인만
  - teacher + scope=all → 무제한
  - teacher + scope=scoped + homeroom 매칭 → OK
  - teacher + scope=scoped + teaching_grades 매칭 → OK
  - teacher + scope=scoped + 매칭 없음 → 403
  - teacher + scope=scoped + enrollment 없음 → 403 (현재 학기 명단에 없음)
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.core.visibility import (
    assert_can_view_student,
    set_view_scope,
    visible_student_user_ids,
)
from app.models.timetable import Semester, SemesterEnrollment


pytestmark = pytest.mark.security  # /api/system/security CI gate


# ── helper ────────────────────────────────────────────────


async def _make_current_semester(db) -> Semester:
    sem = Semester(
        year=2026,
        semester=1,
        name="2026-1",
        start_date=date(2026, 3, 1),
        end_date=date(2026, 7, 31),
        is_current=True,
    )
    db.add(sem)
    await db.flush()
    await db.refresh(sem)
    return sem


async def _enroll(db, *, semester_id, user, role="student",
                  grade=None, class_number=None,
                  homeroom_class=None, subhomeroom_class=None,
                  teaching_grades=None, teaching_classes=None):
    e = SemesterEnrollment(
        semester_id=semester_id, user_id=user.id, role=role, status="active",
        grade=grade, class_number=class_number,
        homeroom_class=homeroom_class, subhomeroom_class=subhomeroom_class,
        teaching_grades=teaching_grades, teaching_classes=teaching_classes,
    )
    db.add(e)
    await db.flush()
    return e


# ── super_admin / designated_admin ────────────────────────


@pytest.mark.asyncio
async def test_super_admin_can_view_any_student_even_scoped(
    db_session, super_admin, student_user,
):
    """super_admin은 scope=scoped여도 모든 학생 열람."""
    await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    await db_session.flush()

    # 통과 (예외 없음)
    await assert_can_view_student(db_session, super_admin, student_user.id)


@pytest.mark.asyncio
async def test_designated_admin_can_view_any_student(
    db_session, designated_admin, student_user,
):
    await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    await db_session.flush()

    await assert_can_view_student(db_session, designated_admin, student_user.id)


# ── student ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_student_can_view_self(db_session, student_user):
    """학생은 본인 데이터만 조회 가능."""
    await assert_can_view_student(db_session, student_user, student_user.id)


@pytest.mark.asyncio
async def test_student_cannot_view_other_student(
    db_session, student_user, seed_perms,
):
    """학생은 다른 학생 데이터 조회 금지."""
    from tests.conftest import _create_user
    other = await _create_user(
        db_session, email="other@test.local", name="Other Student",
        role="student", grade=2, class_number=4, student_number=10,
    )
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await assert_can_view_student(db_session, student_user, other.id)
    assert exc.value.status_code == 403


# ── teacher + scope=all (기본) ─────────────────────────────


@pytest.mark.asyncio
async def test_teacher_scope_all_can_view_any_student(
    db_session, teacher_user, student_user,
):
    """scope=all 기본값이면 교사는 모든 학생 열람."""
    sem = await _make_current_semester(db_session)
    # scope 명시 안 함 → default "all"
    await _enroll(db_session, semester_id=sem.id, user=student_user,
                  role="student", grade=2, class_number=3)
    await db_session.commit()

    await assert_can_view_student(db_session, teacher_user, student_user.id)


# ── teacher + scope=scoped ─────────────────────────────────


@pytest.mark.asyncio
async def test_teacher_scoped_homeroom_match_grants_access(
    db_session, teacher_user, student_user,
):
    """담임 학급이 일치하는 학생은 scope=scoped여도 열람 가능."""
    sem = await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    # 교사: 2-3반 담임
    await _enroll(db_session, semester_id=sem.id, user=teacher_user,
                  role="teacher", homeroom_class="2-3")
    # 학생: 2학년 3반
    await _enroll(db_session, semester_id=sem.id, user=student_user,
                  role="student", grade=2, class_number=3)
    await db_session.commit()

    await assert_can_view_student(db_session, teacher_user, student_user.id)


@pytest.mark.asyncio
async def test_teacher_scoped_other_class_blocked(
    db_session, teacher_user, student_user, seed_perms,
):
    """담임 아닌 다른 반 학생은 scope=scoped면 차단."""
    from tests.conftest import _create_user
    sem = await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    # 교사: 2-3반 담임 (수업 학년/학급 없음)
    await _enroll(db_session, semester_id=sem.id, user=teacher_user,
                  role="teacher", homeroom_class="2-3")
    # 학생: 1학년 1반 (다른 학년+반)
    other = await _create_user(
        db_session, email="other@test.local", name="Other",
        role="student", grade=1, class_number=1,
    )
    await _enroll(db_session, semester_id=sem.id, user=other,
                  role="student", grade=1, class_number=1)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await assert_can_view_student(db_session, teacher_user, other.id)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_teacher_scoped_teaching_grade_grants_access(
    db_session, teacher_user, student_user,
):
    """수업 학년 매칭 시 해당 학년 학생 모두 열람 가능."""
    sem = await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    # 교사: 2학년 수업 (담임 없음)
    await _enroll(db_session, semester_id=sem.id, user=teacher_user,
                  role="teacher", teaching_grades="2")
    # 학생: 2학년 5반 (담임 아닌 다른 반이지만 같은 학년)
    await _enroll(db_session, semester_id=sem.id, user=student_user,
                  role="student", grade=2, class_number=5)
    await db_session.commit()

    await assert_can_view_student(db_session, teacher_user, student_user.id)


@pytest.mark.asyncio
async def test_teacher_scoped_no_enrollment_blocks_all(
    db_session, teacher_user, student_user,
):
    """교사가 현재 학기 명단에 없으면 아무도 못 봄."""
    sem = await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    # teacher_user는 enrollment 미생성
    await _enroll(db_session, semester_id=sem.id, user=student_user,
                  role="student", grade=2, class_number=3)
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await assert_can_view_student(db_session, teacher_user, student_user.id)
    assert exc.value.status_code == 403


# ── visible_student_user_ids 직접 검증 (집합 의미론) ──────


@pytest.mark.asyncio
async def test_visible_set_none_for_super_admin(
    db_session, super_admin,
):
    """super_admin은 None 반환 (= 무제한)."""
    sem = await _make_current_semester(db_session)
    result = await visible_student_user_ids(db_session, super_admin, sem.id)
    assert result is None


@pytest.mark.asyncio
async def test_visible_set_for_teacher_scoped_subhomeroom(
    db_session, teacher_user, student_user, seed_perms,
):
    """부담임 학급도 homeroom과 동일하게 포함."""
    from tests.conftest import _create_user
    sem = await _make_current_semester(db_session)
    await set_view_scope(db_session, "scoped")
    await _enroll(db_session, semester_id=sem.id, user=teacher_user,
                  role="teacher", subhomeroom_class="2-3")
    s1 = await _create_user(db_session, email="s1@t.local", name="s1", role="student",
                             grade=2, class_number=3)
    s2 = await _create_user(db_session, email="s2@t.local", name="s2", role="student",
                             grade=2, class_number=4)
    await _enroll(db_session, semester_id=sem.id, user=s1, role="student",
                  grade=2, class_number=3)
    await _enroll(db_session, semester_id=sem.id, user=s2, role="student",
                  grade=2, class_number=4)
    await db_session.commit()

    visible = await visible_student_user_ids(db_session, teacher_user, sem.id)
    assert visible is not None
    assert s1.id in visible
    assert s2.id not in visible
