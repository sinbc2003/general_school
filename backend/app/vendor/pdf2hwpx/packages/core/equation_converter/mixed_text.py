#!/usr/bin/env python3
"""
한글+수식 혼합 텍스트 분리/변환 엔진

HWP→LaTeX: 한글(U+AC00-U+D7A3 등)과 비한글(수식) 구간을 분리,
           수식 구간만 변환하고 한글은 보존.
LaTeX→HWP: $...$ 및 $$...$$ 구분자 내부만 변환, 나머지 보존.

Usage:
    from mixed_text import convert_hwp_mixed, convert_latex_mixed

    # HWP → LaTeX (혼합)
    result = convert_hwp_mixed("함수 f(x) = x ^{2} +1의 최솟값")
    # → "함수 $f(x) = x^{2}+1$의 최솟값"

    # LaTeX → HWP (혼합)
    result = convert_latex_mixed("함수 $f(x) = x^{2}+1$의 최솟값")
    # → "함수 f(x) = x ^{2} +1의 최솟값"
"""

import re
from rules import HwpToLatexRules, LatexToHwpRules

_h2l = HwpToLatexRules()
_l2h = LatexToHwpRules()

# 한글 유니코드 범위: 가-힣 + ㄱ-ㅎ + ㅏ-ㅣ
_KOREAN_RE = re.compile(r'[\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF]+')

# 한글 + 일반 한국어 문장부호/조사 패턴 (연속된 한글+공백+한글 포함)
_KOREAN_SEGMENT_RE = re.compile(
    r'[\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF]+'
)


def _is_korean_char(ch: str) -> bool:
    """단일 문자가 한글인지 확인"""
    cp = ord(ch)
    return (0xAC00 <= cp <= 0xD7A3 or  # 가-힣
            0x3131 <= cp <= 0x3163 or  # ㄱ-ㅎ, ㅏ-ㅣ
            0x1100 <= cp <= 0x11FF)    # 한글 자모


def _split_korean_math(text: str) -> list[dict]:
    """텍스트를 한글 구간과 수식(비한글) 구간으로 분리.

    Returns:
        list of {"type": "korean"|"math", "text": str}
    """
    segments = []
    i = 0
    n = len(text)

    while i < n:
        if _is_korean_char(text[i]):
            # 한글 구간: 한글 문자 + 뒤따르는 공백(한글 앞까지)
            j = i
            while j < n and (_is_korean_char(text[j]) or
                             (text[j] in ' \t' and j + 1 < n and _is_korean_char(text[j + 1]))):
                j += 1
            segments.append({"type": "korean", "text": text[i:j]})
            i = j
        else:
            # 비한글(수식) 구간
            j = i
            while j < n and not _is_korean_char(text[j]):
                j += 1
            seg_text = text[i:j]
            if seg_text.strip():  # 빈 공백만 있는 구간 무시
                segments.append({"type": "math", "text": seg_text})
            else:
                segments.append({"type": "space", "text": seg_text})
            i = j

    return segments


def convert_hwp_mixed(text: str) -> str:
    """HWP 혼합 텍스트 → LaTeX 혼합 텍스트.

    한글 구간은 보존하고, 수식 구간만 HWP→LaTeX 변환 후 $...$로 감싼다.

    Args:
        text: "함수 f(x) = x ^{2} +1의 최솟값을 구하시오"

    Returns:
        "함수 $f(x) = x^{2}+1$의 최솟값을 구하시오"
    """
    if not text or not text.strip():
        return text

    # 한글이 전혀 없으면 일반 변환
    if not _KOREAN_RE.search(text):
        return _h2l.convert(text)

    segments = _split_korean_math(text)
    result_parts = []

    for seg in segments:
        if seg["type"] == "korean":
            result_parts.append(seg["text"])
        elif seg["type"] == "math":
            converted = _h2l.convert(seg["text"].strip())
            if converted.strip():
                result_parts.append(f"${converted.strip()}$")
            else:
                result_parts.append(seg["text"])
        else:  # space
            result_parts.append(seg["text"])

    result = "".join(result_parts)
    # $$ 연속된 것 정리 (예: $x$$ + $$y$ → $x + y$)
    result = re.sub(r'\$\s*\$', ' ', result)
    return result.strip()


def convert_latex_mixed(text: str) -> str:
    """LaTeX 혼합 텍스트 → HWP 혼합 텍스트.

    $...$ 및 $$...$$ 구분자 내부만 LaTeX→HWP 변환하고, 나머지는 보존.

    Args:
        text: "함수 $f(x) = x^{2}+1$의 최솟값을 구하시오"

    Returns:
        "함수 f(x) = x ^{2} +1의 최솟값을 구하시오"
    """
    if not text or not text.strip():
        return text

    # $ 또는 $$ 가 없으면 일반 변환
    if '$' not in text:
        return _l2h.convert(text)

    # $$...$$ (display math) 먼저, 그 다음 $...$ (inline math)
    def _replace_display(m):
        inner = m.group(1)
        return _l2h.convert(inner)

    def _replace_inline(m):
        inner = m.group(1)
        return _l2h.convert(inner)

    # display math: $$...$$
    result = re.sub(r'\$\$(.+?)\$\$', _replace_display, text, flags=re.DOTALL)
    # inline math: $...$  (not preceded/followed by $)
    result = re.sub(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)', _replace_inline, result)

    return result.strip()


if __name__ == "__main__":
    print("=== HWP Mixed → LaTeX Mixed ===")
    tests_h2l = [
        "함수 f(x) = x ^{2} +1의 최솟값을 구하시오",
        "이차방정식 x ^{2} -3x+2=0의 두 근의 합",
        "{1} over {2} + {3} over {4}",  # 한글 없음 → 일반 변환
        "집합 A = LEFT { 1, 2, 3 RIGHT }의 원소의 개수",
        "삼각형의 넓이는 {1} over {2} TIMES a TIMES h이다",
    ]
    for t in tests_h2l:
        print(f"  {t!r}")
        print(f"  → {convert_hwp_mixed(t)!r}")
        print()

    print("=== LaTeX Mixed → HWP Mixed ===")
    tests_l2h = [
        r"함수 $f(x) = x^{2}+1$의 최솟값을 구하시오",
        r"이차방정식 $x^{2}-3x+2=0$의 두 근의 합",
        r"$\frac{1}{2} + \frac{3}{4}$",  # 한글 없음 → 일반 변환
        r"집합 $A = \left\{ 1, 2, 3 \right\}$의 원소의 개수",
    ]
    for t in tests_l2h:
        print(f"  {t!r}")
        print(f"  → {convert_latex_mixed(t)!r}")
        print()
