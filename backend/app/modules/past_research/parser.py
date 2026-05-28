"""과거 연구 보고서 파일명 파서.

지원 패턴:
    {YYYY} {N}학년 {S}학기 {보고서종류} 보고서({분야}[, {분야2}, ...] 분야)_{제목}[(우수)].pdf

예시:
    2024 2학년 1학기 과학과제연구 보고서(물리 분야)_다이오드의 특성 곡선과 ...pdf
    2026 3학년 1학기 심층연구활동 보고서(화학, 인공지능 분야)_두 약물 ...pdf
    2024 2학년 1학기 과학과제연구 보고서(화학 분야)_탁구공 반발계수에 영향을 주는 요인에 관한 연구(우수).pdf
"""

import os
import re

_FILENAME_RE = re.compile(
    r"""^
    (?P<year>\d{4})\s+
    (?P<grade>\d)\s*학년\s+
    (?P<semester>\d)\s*학기\s+
    (?P<report_type>.+?)\s+보고서
    \(\s*(?P<fields>.+?)\s*분야\s*\)
    _\s*
    (?P<title>.+?)
    \s*$
    """,
    re.VERBOSE,
)


def parse_filename(filename: str) -> dict | None:
    """파일명 파싱. 실패 시 None.

    반환 dict:
        {year, grade, semester, report_type, fields(list[str]), title, is_excellent}
    """
    if not filename:
        return None
    base = os.path.basename(filename).strip()
    stem, _ = os.path.splitext(base)
    if not stem:
        return None

    m = _FILENAME_RE.match(stem)
    if not m:
        return None

    title = m.group("title").strip()
    is_excellent = False
    # 제목 끝의 (우수), (최우수) 같은 표지를 별도 flag로 분리
    excellence_tag = re.search(r"\(\s*(?:우수|최우수|장려|입상)\s*\)\s*$", title)
    if excellence_tag:
        is_excellent = True
        title = title[: excellence_tag.start()].strip()

    fields_raw = m.group("fields")
    fields = [
        f.strip()
        for f in re.split(r"[,/·]", fields_raw)
        if f.strip()
    ]

    try:
        year = int(m.group("year"))
        grade = int(m.group("grade"))
        semester = int(m.group("semester"))
    except ValueError:
        return None

    return {
        "year": year,
        "grade": grade,
        "semester": semester,
        "report_type": m.group("report_type").strip(),
        "fields": fields,
        "title": title,
        "is_excellent": is_excellent,
    }
