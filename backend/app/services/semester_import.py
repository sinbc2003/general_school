"""학기별 명단 CSV 일괄 등록.

교직원 CSV 양식: department, name, phone
학생 CSV 양식:   student_no, name, phone
  - student_no는 "1-3-5", "10305", "1·3·5" 등 자동 parse → grade/class_number/student_number
  - 못 parse하면 그대로 student_number(int 변환 시도) 저장, 학년/반은 null

계정 자동 생성 규칙:
  - username = 이름 (한글 OK). 동명이인은 "홍길동_2", "홍길동_3" suffix
  - email = `{username}@school.local`
  - password = phone에서 '-' 제거. phone 없으면 settings.DEFAULT_USER_PASSWORD
  - must_change_password = True

이미 같은 이름(username) + phone이 같은 User가 있으면 동일인으로 보고 enrollment만 추가.
"""

import csv
import io
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.core.config import settings
from app.models.user import User
from app.models.timetable import SemesterEnrollment


TEACHER_COLUMNS = ["department", "name", "phone"]
STUDENT_COLUMNS = ["student_no", "name", "phone"]


def template_csv(role: str) -> str:
    """역할별 빈 CSV 템플릿 (UTF-8 BOM 포함)."""
    BOM = "﻿"
    if role == "teacher":
        return BOM + "department,name,phone\n수학과,김선생,010-1234-5678\n행정실,이주무관,010-2345-6789\n"
    if role == "student":
        return BOM + "student_no,name,phone\n1-3-5,홍길동,010-1111-2222\n10306,김철수,010-2222-3333\n"
    raise ValueError(f"unknown role: {role}")


_PHONE_STRIP = re.compile(r"[^\d]")


def _normalize_phone(phone: str) -> str:
    """전화번호에서 숫자만 추출. 비밀번호로 사용."""
    return _PHONE_STRIP.sub("", phone or "")


def _parse_student_no(s: str) -> tuple[int | None, int | None, int | None]:
    """학번 parse.

    형식 인식:
      - "1-3-5" / "1·3·5" / "1.3.5" → (1, 3, 5)
      - "10305" 5자리 → (1, 3, 5)
      - "1305" 4자리 → (1, 3, 5)   (학년1+반2+번호2 또는 학년1+반1+번호2 — 5자리가 명확)
      - 그 외: (None, None, int) — 통째로 student_number에 저장
    """
    s = (s or "").strip()
    if not s:
        return None, None, None

    # 구분자 형태 "1-3-5" / "1·3·5" / "1.3.5"
    parts = re.split(r"[-·.\s/]+", s)
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return int(parts[0]), int(parts[1]), int(parts[2])

    # 숫자만 (3~5자리)
    if s.isdigit():
        if len(s) == 5:
            return int(s[0]), int(s[1:3]), int(s[3:])
        if len(s) == 4:
            return int(s[0]), int(s[1:3]), int(s[3:])
        if len(s) == 3:
            return int(s[0]), int(s[1]), int(s[2])

    # fallback
    try:
        return None, None, int(s)
    except ValueError:
        return None, None, None


async def _alloc_username(
    db: AsyncSession, base_name: str,
    taken: set[str], existing: set[str],
) -> str:
    """이름 → 유일한 username. 동명이인은 _2, _3 ..."""
    if base_name not in existing and base_name not in taken:
        return base_name
    for i in range(2, 1000):
        candidate = f"{base_name}_{i}"
        if candidate not in existing and candidate not in taken:
            return candidate
    raise RuntimeError(f"동명이인 너무 많음: {base_name}")


async def import_enrollments_csv(
    db: AsyncSession,
    semester_id: int,
    role: str,
    file_bytes: bytes,
    dry_run: bool = False,
) -> dict:
    """학기별 명단 CSV import.

    role: "teacher" | "student"
    반환: {ok_count, errors, dry_run, created_users, reused_users}
    """
    if role not in ("teacher", "student"):
        raise ValueError(f"unknown role: {role}")

    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    fields = {f.strip().lower() for f in (reader.fieldnames or [])}

    required = {"name", "phone"} | ({"department"} if role == "teacher" else {"student_no"})
    missing = required - fields
    if missing:
        return {
            "ok_count": 0, "errors": [{"row": 1, "error": f"필수 컬럼 누락: {sorted(missing)}"}],
            "dry_run": dry_run, "created_users": 0, "reused_users": 0,
        }

    # 기존 사용자 인덱스
    existing_users = (await db.execute(select(User))).scalars().all()
    by_username: dict[str, User] = {u.username: u for u in existing_users if u.username}
    by_username_phone: dict[tuple[str, str], User] = {
        (u.username, u.phone): u for u in existing_users if u.username and u.phone
    }
    existing_usernames: set[str] = set(by_username.keys())
    existing_emails: set[str] = set(u.email for u in existing_users)

    # 기존 enrollments (이 학기)
    existing_enrolls = (await db.execute(
        select(SemesterEnrollment.user_id).where(SemesterEnrollment.semester_id == semester_id)
    )).scalars().all()
    enrolled_uids = set(existing_enrolls)

    errors: list[dict] = []
    new_users: list[User] = []
    new_enrolls: list[SemesterEnrollment] = []
    taken_usernames: set[str] = set()
    taken_emails: set[str] = set()
    ok_count = 0
    created_users = 0
    reused_users = 0

    for i, row in enumerate(reader, start=2):
        try:
            name = (row.get("name") or "").strip()
            phone_raw = (row.get("phone") or "").strip()
            phone_digits = _normalize_phone(phone_raw)
            if not name:
                raise ValueError("name 비어있음")

            # 1) 기존 사용자 매칭 (이름+phone 동일하면 재사용)
            reuse = by_username_phone.get((name, phone_digits))
            if reuse:
                target_user = reuse
                reused_users += 1
            else:
                # 2) 신규 사용자 생성
                username = await _alloc_username(db, name, taken_usernames, existing_usernames)
                email = f"{username}@school.local"
                # email 충돌 회피
                base_email = email
                e_i = 2
                while email in existing_emails or email in taken_emails:
                    email = f"{username}_{e_i}@school.local"
                    e_i += 1

                password = phone_digits or settings.DEFAULT_USER_PASSWORD
                target_user = User(
                    name=name, username=username, email=email,
                    password_hash=hash_password(password),
                    role=role, status="approved",
                    phone=phone_raw or None,
                    must_change_password=True,
                )
                taken_usernames.add(username)
                taken_emails.add(email)
                new_users.append(target_user)
                created_users += 1

            # 3) Enrollment 생성 (해당 학기에 없으면)
            # (target_user.id는 신규면 flush 후에 채워짐 — 일단 객체로 매칭)
            existing_enrolls_for_user_check = (
                target_user.id in enrolled_uids if target_user.id else False
            )
            if existing_enrolls_for_user_check:
                # 이미 이 학기에 등록됨 → skip
                ok_count += 1
                continue

            enroll_kwargs: dict = {
                "role": role,
                "status": "active",
                "phone": phone_raw or None,
            }
            if role == "teacher":
                enroll_kwargs["department"] = (row.get("department") or "").strip() or None
            else:  # student
                grade, class_num, snum = _parse_student_no(row.get("student_no") or "")
                enroll_kwargs["grade"] = grade
                enroll_kwargs["class_number"] = class_num
                enroll_kwargs["student_number"] = snum

            new_enrolls.append((target_user, enroll_kwargs))
            ok_count += 1

        except Exception as e:
            errors.append({"row": i, "error": str(e)})

    if not dry_run:
        # 신규 사용자 먼저 flush해서 id 확보
        for u in new_users:
            db.add(u)
        if new_users:
            await db.flush()
        # enrollment 생성
        for (target_user, kwargs) in new_enrolls:
            db.add(SemesterEnrollment(
                semester_id=semester_id, user_id=target_user.id, **kwargs
            ))
        if new_enrolls:
            await db.flush()

    return {
        "ok_count": ok_count,
        "errors": errors,
        "dry_run": dry_run,
        "created_users": created_users,
        "reused_users": reused_users,
        "enrolled": len(new_enrolls) if not dry_run else 0,
    }
