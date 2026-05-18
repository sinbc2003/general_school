"""Shared helpers for timetable enrollment endpoints.

여러 enrollment-* sub-module이 공유하는 직렬화·역직렬화 함수.
"""

from app.models.timetable import SemesterEnrollment
from app.models.user import User


def _parse_csv_list(v: str | None) -> list:
    """콤마/공백 구분된 문자열 → 리스트. JSON 형식이면 그대로 파싱."""
    if not v:
        return []
    s = v.strip()
    if s.startswith("["):
        import json
        try:
            return json.loads(s)
        except Exception:
            pass
    return [x.strip() for x in s.replace("|", ",").replace(";", ",").split(",") if x.strip()]


def _enrollment_to_dict(
    e: SemesterEnrollment, u: User | None = None,
    position_count: int = 0,
) -> dict:
    return {
        "id": e.id,
        "semester_id": e.semester_id,
        "user_id": e.user_id,
        "role": e.role,
        "status": e.status,
        "grade": e.grade,
        "class_number": e.class_number,
        "student_number": e.student_number,
        "department": e.department,
        "position": e.position,
        "homeroom_class": e.homeroom_class,
        "subhomeroom_class": e.subhomeroom_class,
        "teaching_grades": _parse_csv_list(e.teaching_grades),
        "teaching_classes": _parse_csv_list(e.teaching_classes),
        "teaching_subjects": _parse_csv_list(e.teaching_subjects),
        "phone": e.phone,
        "note": e.note,
        "onboarded": bool(e.onboarded),
        # 직책 권한 할당 개수 (UI 행에 칩 표시용). 학생은 항상 0.
        "position_count": position_count,
        "user": {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "name": u.name,
            "phone": u.phone,
        } if u else None,
    }


def _serialize_list_field(v) -> str | None:
    """list 또는 콤마 문자열 → 콤마 구분 문자열로 저장."""
    if v is None or v == "":
        return None
    if isinstance(v, list):
        return ",".join(str(x).strip() for x in v if str(x).strip())
    return str(v).strip() or None
