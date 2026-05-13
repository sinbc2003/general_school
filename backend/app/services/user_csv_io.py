"""사용자 일괄 등록 CSV (역할별)

자체 양식 — UTF-8 (BOM 자동 제거). 헤더 첫 줄.

역할별 컬럼 (필수/선택):
  designated_admin: name*, email*, username*, password
  teacher:           name*, email*, username*, password, department
  student:           name*, email*, username*, password, grade, class_number, student_number

password 누락 시 settings.DEFAULT_USER_PASSWORD 사용 + must_change_password=True
이메일/유저네임 중복은 행 단위 실패로 보고.
"""

import csv
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.core.config import settings
from app.models.user import User


CSV_TEMPLATES: dict[str, list[str]] = {
    "designated_admin": ["name", "email", "username", "password"],
    "teacher":          ["name", "email", "username", "password", "department"],
    "student":          ["name", "email", "username", "password",
                         "grade", "class_number", "student_number"],
}

REQUIRED: dict[str, set[str]] = {
    "designated_admin": {"name", "email", "username"},
    "teacher":          {"name", "email", "username"},
    "student":          {"name", "email", "username"},
}


def template_csv(role: str) -> str:
    """빈 헤더만 있는 CSV. UTF-8 BOM 포함 (Excel에서 한글 안 깨짐)."""
    if role not in CSV_TEMPLATES:
        raise ValueError(f"unknown role: {role}")
    cols = CSV_TEMPLATES[role]
    # 예시 행 1줄 추가 (학생만)
    example = ""
    if role == "student":
        example = "홍길동,gildong@school.local,gildong01,,2,3,17\n"
    elif role == "teacher":
        example = "김선생,kim@school.local,kimss,,수학과\n"
    elif role == "designated_admin":
        example = "지정관리자,da@school.local,da01,\n"
    return "﻿" + ",".join(cols) + "\n" + example


def _to_int(v: str) -> int | None:
    v = (v or "").strip()
    return int(v) if v else None


async def import_users_csv(
    db: AsyncSession, role: str, file_bytes: bytes,
    granted_by_user_id: int, dry_run: bool = False,
) -> dict:
    """CSV 일괄 등록. role 외의 컬럼은 무시.
    반환: {ok_count, errors: [{row, error}], dry_run}
    """
    if role not in CSV_TEMPLATES:
        raise ValueError(f"unknown role: {role}")

    text = file_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    fields = set([f.strip() for f in (reader.fieldnames or [])])
    missing = REQUIRED[role] - fields
    if missing:
        return {
            "ok_count": 0,
            "errors": [{"row": 1, "error": f"필수 컬럼 누락: {sorted(missing)}"}],
            "dry_run": dry_run,
        }

    ok_count = 0
    errors: list[dict] = []
    new_users: list[User] = []
    seen_emails: set[str] = set()
    seen_usernames: set[str] = set()

    # 기존 DB 중복 한 번에 조회
    existing_emails = set(
        (await db.execute(select(User.email))).scalars().all()
    )
    existing_usernames = set(
        u for u in (await db.execute(select(User.username))).scalars().all() if u
    )

    for i, row in enumerate(reader, start=2):
        try:
            name = (row.get("name") or "").strip()
            email = (row.get("email") or "").strip().lower()
            username = (row.get("username") or "").strip()
            password = (row.get("password") or "").strip() or settings.DEFAULT_USER_PASSWORD

            if not name or not email or not username:
                raise ValueError("name/email/username 필수")
            if email in existing_emails or email in seen_emails:
                raise ValueError(f"이미 등록된 이메일: {email}")
            if username in existing_usernames or username in seen_usernames:
                raise ValueError(f"이미 등록된 아이디: {username}")
            seen_emails.add(email)
            seen_usernames.add(username)

            kwargs = dict(
                name=name, email=email, username=username,
                password_hash=hash_password(password),
                role=role, status="approved",
                must_change_password=True,
            )
            if role == "teacher":
                kwargs["department"] = (row.get("department") or "").strip() or None
            elif role == "student":
                kwargs["grade"] = _to_int(row.get("grade") or "")
                kwargs["class_number"] = _to_int(row.get("class_number") or "")
                kwargs["student_number"] = _to_int(row.get("student_number") or "")

            new_users.append(User(**kwargs))
            ok_count += 1
        except Exception as e:
            errors.append({"row": i, "error": str(e)})

    if not dry_run and new_users:
        for u in new_users:
            db.add(u)
        await db.flush()

    return {"ok_count": ok_count, "errors": errors, "dry_run": dry_run}
