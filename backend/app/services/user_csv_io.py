"""사용자 일괄 등록 CSV (역할별)

자체 양식 — UTF-8 BOM. 헤더 첫 줄. **한글·영문 헤더 둘 다 인식**.

역할별 컬럼 (필수/선택):
  designated_admin: 이름*, 이메일*, 아이디*, 비밀번호
  teacher:           이름*, 이메일*, 아이디*, 비밀번호, 부서
  student:           이름*, 이메일*, 아이디*, 비밀번호, 학년, 반, 번호

password 누락 시 settings.DEFAULT_USER_PASSWORD 사용 + must_change_password=True
이메일/아이디 중복은 행 단위 실패로 보고.
"""

import csv
import io

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import hash_password
from app.core.config import settings
from app.core.quota import assign_default_quota
from app.models.user import User


# 한글 헤더 → 표준 영문 키 매핑 (한국 학교 친화)
COLUMN_ALIASES: dict[str, str] = {
    # 공통
    "이름": "name", "성명": "name", "name": "name",
    "이메일": "email", "메일": "email", "email": "email", "e-mail": "email",
    "아이디": "username", "ID": "username", "id": "username", "username": "username", "유저네임": "username",
    "비밀번호": "password", "패스워드": "password", "password": "password", "비번": "password",
    # 교사
    "부서": "department", "department": "department", "소속": "department",
    # 학생
    "학년": "grade", "grade": "grade",
    "반": "class_number", "학급": "class_number", "class_number": "class_number", "class": "class_number",
    "번호": "student_number", "출석번호": "student_number", "student_number": "student_number", "no": "student_number",
}


CSV_TEMPLATES: dict[str, list[str]] = {
    "designated_admin": ["이름", "이메일", "아이디", "비밀번호"],
    "teacher":          ["이름", "이메일", "아이디", "비밀번호", "부서"],
    "student":          ["이름", "이메일", "아이디", "비밀번호",
                         "학년", "반", "번호"],
}

# 표준 영문 키 기준 (한글 → 영문 변환 후 검사)
REQUIRED: dict[str, set[str]] = {
    "designated_admin": {"name", "email", "username"},
    "teacher":          {"name", "email", "username"},
    "student":          {"name", "email", "username"},
}


def _normalize_row(row: dict) -> dict:
    """한글/영문 헤더를 표준 영문 키로 변환."""
    out = {}
    for k, v in row.items():
        if k is None:
            continue
        norm = COLUMN_ALIASES.get(k.strip(), k.strip())
        out[norm] = v
    return out


def template_csv(role: str) -> str:
    """한글 헤더 CSV + 예시 + 설명 셀 (B2/C2 같은 비활용 셀에 안내).

    UTF-8 BOM 포함 — Excel·LibreOffice에서 한글 안 깨짐.
    """
    if role not in CSV_TEMPLATES:
        raise ValueError(f"unknown role: {role}")
    cols = CSV_TEMPLATES[role]
    BOM = "﻿"
    header = ",".join(cols)

    if role == "student":
        example = "홍길동,gildong@school.local,10101,,1,1,1"
        descs = [
            "# 이름 필수 (실명)",
            "# 이메일 필수 (학교/개인 메일)",
            "# 아이디 필수 (학번 권장: 학년+반+번호 5자리 예 10101)",
            "# 비번 빈칸이면 기본값 + 첫 로그인 시 강제 변경",
            "# 학년 1·2·3",
            "# 반 숫자",
            "# 번호 출석번호",
        ]
    elif role == "teacher":
        example = "김선생,kim@school.local,kimss,,수학과"
        descs = [
            "# 이름 필수 (실명)",
            "# 이메일 필수 (학교 메일)",
            "# 아이디 필수 (영문+숫자 8자 이상 권장)",
            "# 비번 빈칸이면 기본값 + 첫 로그인 시 강제 변경",
            "# 부서명 (마법사 2단계에서 등록한 부서명과 정확히 일치)",
        ]
    else:
        example = "지정관리자,da@school.local,da01,"
        descs = [
            "# 이름 필수",
            "# 이메일 필수",
            "# 아이디 필수",
            "# 비번 빈칸 시 기본값",
        ]

    # 헤더 + 예시 행 + 빈 셀에 설명 (Excel에서 #로 시작하는 셀은 데이터 무시)
    # 각 컬럼 설명을 3행에 배치 (영향 없는 행)
    desc_row = ",".join(descs) if len(descs) == len(cols) else ""
    return BOM + header + "\n" + example + "\n" + desc_row + "\n"


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
    # 헤더를 표준 영문 키로 변환 (한글 헤더 지원)
    raw_fields = [f.strip() for f in (reader.fieldnames or [])]
    normalized_fields = {COLUMN_ALIASES.get(f, f) for f in raw_fields}
    missing = REQUIRED[role] - normalized_fields
    if missing:
        # 한글 표현으로 에러 메시지
        ko_map = {"name": "이름", "email": "이메일", "username": "아이디"}
        ko_missing = [ko_map.get(m, m) for m in sorted(missing)]
        return {
            "ok_count": 0,
            "errors": [{"row": 1, "error": f"필수 컬럼 누락: {ko_missing}"}],
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
        # 한글 헤더 row를 영문 키로 변환
        row = _normalize_row(row)

        # 주석 행(# 으로 시작) skip — 템플릿의 설명 행 무시
        first_val = (row.get("name") or "").strip()
        if first_val.startswith("#"):
            continue
        try:
            name = first_val
            email = (row.get("email") or "").strip().lower()
            username = (row.get("username") or "").strip()
            password = (row.get("password") or "").strip() or settings.DEFAULT_USER_PASSWORD

            if not name or not email or not username:
                raise ValueError("이름/이메일/아이디 필수")
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
            assign_default_quota(u)
            db.add(u)
        await db.flush()

    return {"ok_count": ok_count, "errors": errors, "dry_run": dry_run}
