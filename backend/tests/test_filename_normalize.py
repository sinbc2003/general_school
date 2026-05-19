"""파일명 정규화 테스트.

`app/core/filename_normalize.py`의 `render()` 함수를 검증.
"""

from datetime import date

import pytest

from app.core.filename_normalize import (
    SUPPORTED_VARS, ensure_unique, preview, render,
)


class _Student:
    """User stub for testing — User 모델 import 안 하고 dataclass-like."""
    def __init__(self, grade=None, class_number=None, student_number=None, name=None):
        self.grade = grade
        self.class_number = class_number
        self.student_number = student_number
        self.name = name


# ── 기본 정규화 ────────────────────────────────────────────


def test_basic_pattern():
    s = _Student(grade=2, class_number=3, student_number=15, name="홍길동")
    result = render(
        "{grade}-{class}_{number}_{name}_{original}",
        student=s,
        original_filename="보고서.pdf",
    )
    assert result == "2-3_15_홍길동_보고서.pdf"


def test_extension_auto_append():
    """패턴에 {ext} 없으면 끝에 자동 추가."""
    s = _Student(grade=1, class_number=1, student_number=1, name="김학생")
    result = render("{name}_{original}", student=s, original_filename="test.docx")
    assert result.endswith(".docx")


def test_extension_explicit():
    """{ext} 명시 시 그대로."""
    s = _Student(name="홍길동")
    result = render("{name}{ext}", student=s, original_filename="test.pdf")
    assert result == "홍길동.pdf"


def test_date_default():
    """{date} 기본은 YYYYMMDD."""
    s = _Student(name="A")
    today = date(2026, 5, 19)
    result = render("{date}_{name}", student=s, original_filename="x.pdf", today=today)
    assert result == "20260519_A.pdf"


def test_date_custom_format():
    """{date:format} 커스텀."""
    s = _Student(name="A")
    today = date(2026, 5, 19)
    result = render(
        "{date:YYYY-MM-DD}_{name}",
        student=s, original_filename="x.pdf", today=today,
    )
    assert result == "2026-05-19_A.pdf"


def test_extra_variables():
    """extra dict로 컨텍스트 변수 주입 (예: assignment_title)."""
    s = _Student(name="A")
    result = render(
        "[{assignment_title}]_{name}_{original}",
        student=s,
        original_filename="answer.pdf",
        extra={"assignment_title": "1차 시험"},
    )
    assert result == "[1차_시험]_A_answer.pdf"


# ── 누락 / 비정상 입력 ────────────────────────────────────


def test_missing_student_fields():
    """학생 필드 없을 때 한글 fallback ('미정' — `?`는 Windows 위험 문자)."""
    s = _Student(name="홍길동")  # grade/class/number 모두 None
    result = render(
        "{grade}-{class}_{number}_{name}_{original}",
        student=s,
        original_filename="x.pdf",
    )
    assert result == "미정-미정_미정_홍길동_x.pdf"


def test_no_student():
    """student 없으면 모두 fallback."""
    result = render(
        "{grade}-{class}_{number}_{name}_{original}",
        student=None,
        original_filename="x.pdf",
    )
    assert "미정-미정_미정_이름없음_x" in result


def test_empty_pattern_returns_original():
    """패턴 비어있으면 원본 그대로."""
    result = render("", original_filename="orig.pdf")
    assert result == "orig.pdf"


def test_none_pattern():
    """None 패턴도 원본."""
    result = render(None, original_filename="x.txt")  # type: ignore
    assert result == "x.txt"


def test_unknown_variable_kept():
    """지원 안 하는 변수는 패턴 그대로 남김."""
    s = _Student(name="A")
    result = render("{foo}_{name}", student=s, original_filename="x.pdf")
    assert "{foo}" in result


# ── 보안 / 안전성 ──────────────────────────────────────────


def test_path_traversal_blocked():
    """name에 ../ 들어가도 안전."""
    s = _Student(name="../etc/passwd")
    result = render("{name}_{original}", student=s, original_filename="x.pdf")
    assert ".." not in result
    assert "/" not in result


def test_unsafe_chars_replaced():
    """파일명 위험 문자 (/ \\ : * ? " < > |) → _ 치환."""
    s = _Student(name="홍/길*동")
    result = render("{name}_{original}", student=s, original_filename='bad:file?.pdf')
    for c in "/\\:*?<>|":
        assert c not in result


def test_long_name_truncated():
    """파일명 200자 한도."""
    s = _Student(name="가" * 300)
    result = render("{name}_{original}", student=s, original_filename="x.pdf")
    assert len(result) <= 200


def test_korean_preserved():
    """한글은 보존."""
    s = _Student(name="홍길동", grade=2, class_number=3, student_number=15)
    result = render(
        "{grade}-{class}_{name}_{original}",
        student=s, original_filename="기말과제.pdf",
    )
    assert "홍길동" in result
    assert "기말과제" in result


# ── 충돌 회피 ────────────────────────────────────────────


def test_ensure_unique_no_conflict(tmp_path):
    """같은 이름 파일 없으면 그대로."""
    result = ensure_unique(tmp_path, "test.pdf")
    assert result == "test.pdf"


def test_ensure_unique_with_conflict(tmp_path):
    """같은 이름 파일 있으면 _v2 자동 추가."""
    (tmp_path / "test.pdf").write_text("first")
    result = ensure_unique(tmp_path, "test.pdf")
    assert result == "test_v2.pdf"


def test_ensure_unique_multi_conflict(tmp_path):
    """여러 충돌 시 _v3, _v4 ..."""
    (tmp_path / "test.pdf").write_text("v1")
    (tmp_path / "test_v2.pdf").write_text("v2")
    (tmp_path / "test_v3.pdf").write_text("v3")
    result = ensure_unique(tmp_path, "test.pdf")
    assert result == "test_v4.pdf"


# ── preview 헬퍼 ──────────────────────────────────────────


def test_preview_with_dict_student():
    """dict 형태 student로 미리보기."""
    result = preview(
        "{grade}-{class}_{name}",
        student={"grade": 2, "class_number": 3, "name": "홍길동"},
    )
    assert "2-3_홍길동" in result


# ── 지원 변수 목록 ────────────────────────────────────────


def test_supported_vars_set():
    """문서화된 변수 목록 확인."""
    expected = {
        "grade", "class", "number", "student_number", "name",
        "date", "original", "ext",
        "assignment_title", "club_name", "project_title",
    }
    assert SUPPORTED_VARS == expected
