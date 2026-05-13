"""학생 가시성(visibility) 정책 — 교사가 어떤 학생을 볼 수 있는지.

정책 (Setting 키 `teacher_view_scope`):
  - "all"     : 모든 학생 열람 (기본)
  - "scoped"  : 본인 담임/부담임 학급 + 본인 수업 학년/학급 학생만

학생 본인: 항상 본인 데이터만 (이 헬퍼와 별개).
super_admin, designated_admin, staff(권한 있는 경우): 정책 무관 모든 학생.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import Setting
from app.models.timetable import SemesterEnrollment
from app.models.user import User


SETTING_KEY = "teacher_view_scope"
DEFAULT_SCOPE = "all"
VALID_SCOPES = {"all", "scoped"}


async def get_view_scope(db: AsyncSession) -> str:
    row = (await db.execute(select(Setting).where(Setting.key == SETTING_KEY))).scalar_one_or_none()
    val = (row.value if row else None) or DEFAULT_SCOPE
    return val if val in VALID_SCOPES else DEFAULT_SCOPE


async def set_view_scope(db: AsyncSession, scope: str) -> None:
    if scope not in VALID_SCOPES:
        raise ValueError(f"invalid scope: {scope}")
    row = (await db.execute(select(Setting).where(Setting.key == SETTING_KEY))).scalar_one_or_none()
    if row:
        row.value = scope
    else:
        db.add(Setting(key=SETTING_KEY, value=scope))


def _parse_list(s: str | None) -> list[str]:
    if not s:
        return []
    return [x.strip() for x in s.replace("|", ",").replace(";", ",").split(",") if x.strip()]


async def visible_student_user_ids(
    db: AsyncSession,
    viewer: User,
    semester_id: int,
) -> set[int] | None:
    """
    viewer가 볼 수 있는 학생 user_id 집합을 반환.

    반환:
      - None  : 제한 없음 (모든 학생 열람 가능). super_admin/designated_admin,
                또는 scope="all"인 교사, 또는 학생/직원 기타.
      - set() : 제한 있음 (빈 집합이면 아무 학생도 못 봄).

    교사 + scope=scoped:
      - 본인 enrollment의 homeroom_class, subhomeroom_class,
        teaching_grades, teaching_classes로 매칭되는 학생 user_id 추출.
    """
    # 관리자 권한자는 무제한
    if viewer.role in ("super_admin", "designated_admin"):
        return None
    # 학생은 본인만 봐야 하지만, 이 함수는 "학생 명단을 보는 시점"용.
    # 학생은 보통 학생 명단 페이지에 안 들어오므로 빈 집합 반환.
    if viewer.role == "student":
        return {viewer.id}
    # 교사 + 직원
    if viewer.role not in ("teacher", "staff"):
        return None

    scope = await get_view_scope(db)
    if scope == "all":
        return None

    # 본인 enrollment 조회 — semester_id 한정
    my_enroll = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == semester_id,
            SemesterEnrollment.user_id == viewer.id,
        )
    )).scalar_one_or_none()

    if not my_enroll:
        # 본인이 해당 학기 명단에 없음 → 아무 학생도 못 봄
        return set()

    homeroom = (my_enroll.homeroom_class or "").strip()
    subhomeroom = (my_enroll.subhomeroom_class or "").strip()
    teaching_grades = _parse_list(my_enroll.teaching_grades)
    teaching_classes = _parse_list(my_enroll.teaching_classes)

    # 매칭 조건 빌드:
    # - 담임/부담임 학급의 학생 (grade=X, class_number=Y)
    # - 수업 학년의 모든 학생
    # - 수업 학급의 학생 (학년+반)
    conds = []
    for cls_str in [homeroom, subhomeroom] + teaching_classes:
        if not cls_str:
            continue
        try:
            g, c = cls_str.split("-", 1)
            conds.append(
                (SemesterEnrollment.grade == int(g)) & (SemesterEnrollment.class_number == int(c))
            )
        except (ValueError, IndexError):
            continue

    grade_ints = []
    for g in teaching_grades:
        try:
            grade_ints.append(int(g))
        except ValueError:
            continue
    if grade_ints:
        conds.append(SemesterEnrollment.grade.in_(grade_ints))

    if not conds:
        return set()

    from sqlalchemy import or_
    rows = (await db.execute(
        select(SemesterEnrollment.user_id).where(
            SemesterEnrollment.semester_id == semester_id,
            SemesterEnrollment.role == "student",
            SemesterEnrollment.status == "active",
            or_(*conds),
        )
    )).scalars().all()
    return set(rows)


async def assert_can_view_student(
    db: AsyncSession,
    viewer: User,
    target_student_id: int,
) -> None:
    """학생 데이터 접근 권한 검증. 통과하면 None, 실패면 HTTPException(403).

    규칙:
      - super_admin / designated_admin → 무제한
      - student → 본인 데이터만 (target_student_id == viewer.id)
      - teacher / staff → 현재 학기 정책에 따라 visible_student_user_ids 매칭

    호출 시점: 각 학생 상세 엔드포인트의 첫 줄에서 호출.
    """
    if viewer.role in ("super_admin", "designated_admin"):
        return
    if viewer.role == "student":
        if viewer.id != target_student_id:
            raise HTTPException(403, "본인의 정보만 조회할 수 있습니다.")
        return
    if viewer.role not in ("teacher", "staff"):
        raise HTTPException(403, "권한이 없습니다.")

    # 교사/직원: 정책 적용
    from app.core.semester import get_active_semester_id_or_404
    semester_id = await get_active_semester_id_or_404(db)
    visible = await visible_student_user_ids(db, viewer, semester_id)
    if visible is None:
        return  # 무제한 (scope=all)
    if target_student_id not in visible:
        raise HTTPException(
            403,
            "담당 학생만 조회할 수 있습니다. (관리자가 '교사 학생 열람 범위' 정책을 '담당 학생만'으로 설정한 상태)",
        )
