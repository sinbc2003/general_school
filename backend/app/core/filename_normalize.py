"""파일명 정규화 — 작성자 지정 템플릿에 학생/컨텍스트 변수를 채워 표준 파일명 생성.

사용 시나리오:
  - 교사가 과제 만들 때 패턴 입력: "{grade}-{class}_{number}_{name}_{original}"
  - 학생이 업로드: "보고서.pdf" → "2-3_15_홍길동_보고서.pdf"
  - 공개 갤러리·생기부·관리자가 한눈에 식별 가능

지원 변수 (괄호 안: 비어있을 때 fallback):
  {grade}            학년 (예: 2). 없으면 "미정"
  {class}            반 (예: 3). 없으면 "미정"
  {class2}           2자리 zero-pad 반 (예: 03)
  {number}           번호 (예: 15). 없으면 "미정"
  {number2}          2자리 zero-pad 번호 (예: 05, 15)
  {student_number}   학생 학번 컬럼 (있다면). 없으면 {number}
  {snum5}            한국 학교 표준 5자리 학번 (예: 20315 = 2학년 3반 15번).
                     User.student_number가 5자리면 그대로, 아니면 grade+class2+number2 조합.
  {name}             이름. 없으면 "이름없음"
  {date}             업로드 날짜 YYYYMMDD
  {date:format}      커스텀 포맷 (예: {date:YYYY-MM-DD}, {date:MM-DD})
  {original}         원본 파일명 (확장자 제외, 한글 OK)
  {ext}              확장자 (점 포함, 예: ".pdf")
  {assignment_title} 과제 제목 (Assignment 컨텍스트)
  {club_name}        동아리명 (Club 컨텍스트)
  {project_title}    연구 프로젝트 제목 (Research 컨텍스트)

특수 동작:
  - 잘못된 변수 (지원 안 함) → 패턴 그대로 남김 (예: {foo})
  - 결과에 path traversal·OS 위험 문자 (/ \\ : * ? " < > | 등) 자동 치환 → "_"
  - 한글·영문·숫자·점·하이픈·언더스코어·괄호만 허용 (다른 문자는 "_")
  - 결과 길이 200자 제한 (OS·파일시스템 안전 폭)
  - {ext}는 결과에 자동 추가 안 됨 (패턴에 명시해야 함). 안 명시하면 끝에 자동 추가.
"""

import re
from datetime import date as _date, datetime
from typing import Any


# 지원하는 변수 keys (확장 시 여기에 추가)
SUPPORTED_VARS = {
    "grade", "class", "class2", "number", "number2",
    "student_number", "snum5", "name",
    "date", "original", "ext",
    "assignment_title", "club_name", "project_title",
}


def _zero_pad(value, width: int) -> str:
    """int·str을 width 자리 zero-pad (실패 시 원본)."""
    try:
        return str(int(value)).zfill(width)
    except (TypeError, ValueError):
        return str(value or "")


def _korean_snum5(student) -> str:
    """한국 학교 표준 5자리 학번 생성.

    우선순위:
      1. student.student_number가 5자리 정수면 그대로 (예: 20315)
      2. 그 외 grade(1자리) + class(2자리 zero-pad) + number(2자리 zero-pad)
      3. 누락 시 "미정"
    """
    if not student:
        return "미정"
    snum = getattr(student, "student_number", None)
    # 이미 5자리 학번이면 그대로 사용 (10000 ~ 99999)
    try:
        if snum is not None and 10000 <= int(snum) <= 99999:
            return str(int(snum))
    except (TypeError, ValueError):
        pass
    # 조합 생성
    g = getattr(student, "grade", None)
    c = getattr(student, "class_number", None)
    n = getattr(student, "student_number", None) or snum
    if g is None or c is None or n is None:
        return "미정"
    try:
        return f"{int(g)}{int(c):02d}{int(n):02d}"
    except (TypeError, ValueError):
        return "미정"

# 파일명에 위험한 문자 (Windows·POSIX 공통)
_UNSAFE_CHARS = re.compile(r'[/\\:*?"<>|\x00-\x1f]')


def _safe_segment(s: str) -> str:
    """파일명 1개 segment를 안전하게 정리 (공백·특수문자 제거, 길이 제한)."""
    if not s:
        return ""
    s = str(s).strip()
    s = _UNSAFE_CHARS.sub("_", s)
    # 다중 공백 → 단일 underscore
    s = re.sub(r"\s+", "_", s)
    # 양 끝 점 제거 (Windows 안전)
    s = s.strip(".")
    return s[:80]  # 단일 변수 80자 한도


def _format_date(today: _date, spec: str | None) -> str:
    """{date} 또는 {date:format} 처리.

    포맷 지원 (사용자 친화적):
      YYYY → 2026, YY → 26, MM → 05, DD → 19, MMDD → 0519, YYYYMMDD → 20260519
      대시(-) 슬래시(/) 포함 가능: YYYY-MM-DD, YYYY/MM/DD
    Python strftime 형식도 부분 지원: %Y, %m, %d
    """
    if not spec:
        return today.strftime("%Y%m%d")
    # 사용자 친화 패턴 → strftime 변환
    out = spec
    replacements = [
        ("YYYY", "%Y"), ("YY", "%y"),
        ("MM", "%m"), ("DD", "%d"),
    ]
    for src, dst in replacements:
        out = out.replace(src, dst)
    return today.strftime(out)


def render(
    pattern: str,
    *,
    student: Any | None = None,
    original_filename: str | None = None,
    extra: dict | None = None,
    today: _date | None = None,
) -> str:
    """패턴에 변수를 채워 파일명 생성.

    Args:
        pattern: "{grade}-{class}_{number}_{name}_{original}" 같은 템플릿
        student: User 객체 (grade, class_number, student_number, name 추출)
        original_filename: 원본 파일명 (확장자 자동 분리)
        extra: 컨텍스트별 변수 (예: {"assignment_title": "1차 과제"})
        today: 날짜 (테스트 시 주입 가능, 기본 오늘)

    Returns:
        정규화된 파일명 (확장자 포함). 패턴 비어있으면 원본 그대로 반환.

    실패 케이스:
        - 패턴이 None/empty: original_filename 반환
        - 변수 누락: 빈 문자열로 대체 (단 grade/class/number는 "?", name은 "이름없음")
    """
    if not pattern:
        return original_filename or "file"

    today = today or _date.today()
    extra = extra or {}

    # 원본 파일명·확장자 분리
    orig_name, orig_ext = _split_ext(original_filename or "file")

    # 변수 dict 구성 (fallback은 한글 — `?`는 Windows 파일명 위험 문자라 사용 금지)
    g = getattr(student, "grade", None) if student else None
    c = getattr(student, "class_number", None) if student else None
    n = getattr(student, "student_number", None) if student else None
    values: dict[str, str] = {
        "grade": str(g) if g is not None else "미정",
        "class": str(c) if c is not None else "미정",
        "class2": _zero_pad(c, 2) if c is not None else "미정",
        "number": str(n) if n is not None else "미정",
        "number2": _zero_pad(n, 2) if n is not None else "미정",
        "name": _safe_segment(getattr(student, "name", "") or "이름없음") if student else "이름없음",
        "original": _safe_segment(orig_name),
        "ext": orig_ext,
    }
    # student_number는 number와 동일 fallback
    values["student_number"] = values["number"]
    # 한국 학교 표준 5자리 학번
    values["snum5"] = _korean_snum5(student)

    # extra 변수 (assignment_title, club_name 등)
    for k, v in extra.items():
        if k in SUPPORTED_VARS:
            values[k] = _safe_segment(str(v))

    # {date} / {date:format} 처리
    pattern_with_date = re.sub(
        r"\{date(?::([^}]+))?\}",
        lambda m: _format_date(today, m.group(1)),
        pattern,
    )

    # 일반 변수 치환 — 지원 안 하는 변수는 그대로 둠
    def _replace_var(m: re.Match) -> str:
        key = m.group(1)
        if key in values:
            return values[key]
        return m.group(0)  # 그대로

    # 변수명: 영문자로 시작 + 영문자/숫자/언더스코어 (snum5, class2, number2 같은 패턴 지원)
    rendered = re.sub(r"\{([a-z][a-z0-9_]*)\}", _replace_var, pattern_with_date)

    # 결과에 ext 없으면 자동 추가
    if orig_ext and not rendered.endswith(orig_ext):
        rendered = f"{rendered}{orig_ext}"

    # 최종 안전 처리
    rendered = _UNSAFE_CHARS.sub("_", rendered)
    rendered = rendered.strip(". ")
    # 너무 긴 경우 절단 (확장자 보존)
    if len(rendered) > 200:
        base, ext = _split_ext(rendered)
        rendered = base[: 200 - len(ext)] + ext

    if not rendered:
        return original_filename or "file"
    return rendered


def _split_ext(filename: str) -> tuple[str, str]:
    """파일명을 (이름, 확장자) 튜플로 분리. 확장자는 점 포함."""
    import os
    base, ext = os.path.splitext(filename or "")
    return base, ext.lower()


def preview(
    pattern: str,
    *,
    student: dict | None = None,
    extra: dict | None = None,
) -> str:
    """frontend에서 패턴 입력하는 동안 실시간 미리보기용 헬퍼.

    student: dict 형태 — {"grade": 2, "class_number": 3, "student_number": 15, "name": "홍길동"}
    """
    class _Stub:
        def __init__(self, d): self.__dict__.update(d or {})

    return render(
        pattern,
        student=_Stub(student) if student else None,
        original_filename="원본파일.pdf",
        extra=extra,
    )


def ensure_unique(target_dir, filename: str, max_attempts: int = 100) -> str:
    """동일 이름 파일이 디렉토리에 이미 있으면 `_v2`, `_v3`...로 충돌 회피.

    Args:
        target_dir: pathlib.Path 또는 str
        filename: 시작 파일명
    Returns:
        충돌 없는 최종 파일명
    """
    from pathlib import Path
    target_dir = Path(target_dir)
    candidate = filename
    base, ext = _split_ext(filename)
    n = 2
    while (target_dir / candidate).exists() and n <= max_attempts:
        candidate = f"{base}_v{n}{ext}"
        n += 1
    return candidate
