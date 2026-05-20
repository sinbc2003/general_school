"""학기 자동 강좌 생성 — 교과 / 학년부 / 학급 강좌를 enrollment 기반으로 일괄 생성.

호출:
  - 온보딩 마법사 Step7
  - 학기 관리 페이지 "강좌 자동 생성" 버튼

원칙:
  - 멱등 (이미 존재하면 skip)
  - dry_run 옵션 (영향만 보여주고 실행 X)
  - 학년부 강좌: User.is_grade_lead=True인 사용자를 owner, 같은 학년 담임을 co_teacher
  - 학급 강좌: enrollment에서 담임(homeroom_class_grade/_number)을 owner, 부담임을 co_teacher
  - 교과 강좌: enrollment.teaching_subjects × teaching_classes 조합

palette colors는 강좌 타입별 기본:
  - subject: #7986CB (보라)
  - grade_office: #f59e0b (앰버)
  - class_homeroom: #10b981 (에메랄드)
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Course, CourseStudent, CourseTeacher, Semester, SemesterEnrollment, User,
)


GRADE_OFFICE_COLOR = "#f59e0b"
CLASS_HOMEROOM_COLOR = "#10b981"
SUBJECT_COLOR = "#7986CB"


async def _existing_course_key(
    db: AsyncSession, semester_id: int, course_type: str, key: dict
) -> Course | None:
    """주어진 학기 + 타입 + key dict (subject/class_name/grade_level)에 일치하는 강좌 1개."""
    q = select(Course).where(
        Course.semester_id == semester_id,
        Course.course_type == course_type,
    )
    if "subject" in key:
        q = q.where(Course.subject == key["subject"])
    if "class_name" in key:
        q = q.where(Course.class_name == key["class_name"])
    if "grade_level" in key:
        q = q.where(Course.grade_level == key["grade_level"])
    return (await db.execute(q.limit(1))).scalar_one_or_none()


async def _add_coteacher_if_missing(db: AsyncSession, course_id: int, user_id: int) -> None:
    if not user_id:
        return
    exists = (await db.execute(
        select(CourseTeacher).where(
            CourseTeacher.course_id == course_id, CourseTeacher.user_id == user_id,
        )
    )).scalar_one_or_none()
    if exists:
        return
    db.add(CourseTeacher(course_id=course_id, user_id=user_id, role="co_teacher"))


async def seed_grade_office_courses(
    db: AsyncSession, semester_id: int, *, dry_run: bool = False,
) -> dict:
    """학년부 강좌 생성. 학년부장 = owner, 같은 학년 담임 = co_teacher."""
    sem = await db.get(Semester, semester_id)
    if not sem:
        return {"created": 0, "skipped": 0, "errors": ["학기 없음"]}

    # 1) 학년부장 모두 조회
    leads = (await db.execute(
        select(User).where(
            User.is_grade_lead == True, User.lead_grade.isnot(None),
            User.status != "disabled",
        )
    )).scalars().all()

    created = 0
    skipped = 0
    errors: list[str] = []
    preview: list[dict] = []

    for lead in leads:
        grade = lead.lead_grade
        # 이미 존재?
        existing = await _existing_course_key(
            db, semester_id, "grade_office", {"grade_level": grade}
        )
        if existing:
            skipped += 1
            preview.append({"grade": grade, "status": "skip", "name": existing.name})
            continue

        name = f"{grade}학년 학년부"
        preview.append({"grade": grade, "status": "create", "name": name, "owner": lead.name})

        if dry_run:
            continue

        course = Course(
            semester_id=semester_id,
            teacher_id=lead.id,
            subject="학년부",
            class_name=None,
            name=name,
            description=f"{grade}학년 학년부 강좌 (자동 생성)",
            is_active=True,
            course_type="grade_office",
            grade_level=grade,
            banner_color=GRADE_OFFICE_COLOR,
            viewable_by="all_teachers",
        )
        db.add(course)
        await db.flush()

        # 담임들을 co_teacher로 추가 (homeroom_class="N-M" 형식에서 같은 학년 추출)
        homerooms = (await db.execute(
            select(SemesterEnrollment.user_id, SemesterEnrollment.homeroom_class).where(
                SemesterEnrollment.semester_id == semester_id,
                SemesterEnrollment.homeroom_class.isnot(None),
            )
        )).all()
        for uid, hr_class in homerooms:
            if not hr_class or "-" not in hr_class:
                continue
            try:
                hr_grade = int(hr_class.split("-")[0])
            except (ValueError, IndexError):
                continue
            if hr_grade == grade and uid != lead.id:
                await _add_coteacher_if_missing(db, course.id, uid)

        created += 1

    if not dry_run:
        await db.flush()

    return {"created": created, "skipped": skipped, "errors": errors, "preview": preview}


async def seed_class_homeroom_courses(
    db: AsyncSession, semester_id: int, *, dry_run: bool = False,
) -> dict:
    """학급 강좌 생성. 담임 = owner. 학생 자동 등록.

    enrollment에서 homeroom_class_grade + homeroom_class_number 조합으로 학급 식별.
    """
    # 학급 → 담임 매핑 (homeroom_class="N-M" 형식)
    enrolls = (await db.execute(
        select(SemesterEnrollment).where(
            SemesterEnrollment.semester_id == semester_id,
            SemesterEnrollment.homeroom_class.isnot(None),
        )
    )).scalars().all()

    # 담임 (1학급 1명 기대): (grade, class) → user_id
    homeroom_map: dict[tuple[int, int], int] = {}
    for e in enrolls:
        if not e.homeroom_class or "-" not in e.homeroom_class:
            continue
        try:
            g, c = e.homeroom_class.split("-")
            homeroom_map[(int(g), int(c))] = e.user_id
        except (ValueError, IndexError):
            continue

    created = 0
    skipped = 0
    preview: list[dict] = []
    errors: list[str] = []

    for (grade, cls), teacher_id in homeroom_map.items():
        class_name = f"{grade}-{cls}"
        existing = await _existing_course_key(
            db, semester_id, "class_homeroom", {"class_name": class_name}
        )
        if existing:
            skipped += 1
            preview.append({"class": class_name, "status": "skip", "name": existing.name})
            continue

        teacher = await db.get(User, teacher_id)
        owner_name = teacher.name if teacher else f"user:{teacher_id}"
        name = f"{grade}학년 {cls}반"
        preview.append({"class": class_name, "status": "create", "name": name, "owner": owner_name})

        if dry_run:
            continue

        course = Course(
            semester_id=semester_id,
            teacher_id=teacher_id,
            subject="학급",
            class_name=class_name,
            name=name,
            description=f"{name} 학급 강좌 (자동 생성)",
            is_active=True,
            course_type="class_homeroom",
            grade_level=grade,
            banner_color=CLASS_HOMEROOM_COLOR,
            viewable_by="all_teachers",
        )
        db.add(course)
        await db.flush()

        # 해당 학급 학생 자동 등록
        students = (await db.execute(
            select(User).where(
                User.role == "student",
                User.grade == grade,
                User.class_number == cls,
                User.status != "disabled",
            )
        )).scalars().all()
        for st in students:
            db.add(CourseStudent(course_id=course.id, student_id=st.id, status="active"))

        created += 1

    if not dry_run:
        await db.flush()

    return {"created": created, "skipped": skipped, "errors": errors, "preview": preview}


async def seed_courses(
    db: AsyncSession,
    semester_id: int,
    *,
    grade_office: bool = True,
    class_homeroom: bool = True,
    subject: bool = False,  # 교과 강좌는 시간표 등록 후에만 권장
    dry_run: bool = False,
) -> dict:
    """일괄 자동 생성. 결과 요약 반환."""
    summary: dict = {"types": {}, "total_created": 0, "total_skipped": 0, "dry_run": dry_run}
    if grade_office:
        r = await seed_grade_office_courses(db, semester_id, dry_run=dry_run)
        summary["types"]["grade_office"] = r
        summary["total_created"] += r["created"]
        summary["total_skipped"] += r["skipped"]
    if class_homeroom:
        r = await seed_class_homeroom_courses(db, semester_id, dry_run=dry_run)
        summary["types"]["class_homeroom"] = r
        summary["total_created"] += r["created"]
        summary["total_skipped"] += r["skipped"]
    return summary
