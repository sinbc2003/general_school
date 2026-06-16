#!/usr/bin/env python3
"""
통합 변환 API

rules.py + mixed_text.py를 감싸는 깔끔한 API 레이어.
단일 변환, 일괄 변환, 파일 변환을 제공.

Usage:
    from converter import convert_single, convert_batch, convert_file

    result = convert_single("x ^{2}", "hwp_to_latex")
    results = convert_batch(["x ^{2}", "sin x"], "hwp_to_latex")
    output = convert_file("x ^{2}\\nsin x", "hwp_to_latex")
"""

from rules import HwpToLatexRules, LatexToHwpRules
from mixed_text import convert_hwp_mixed, convert_latex_mixed

_h2l = HwpToLatexRules()
_l2h = LatexToHwpRules()


def convert_single(text: str, direction: str, mixed_mode: bool = False) -> str:
    """단일 텍스트 변환.

    Args:
        text: 변환할 텍스트
        direction: "hwp_to_latex" 또는 "latex_to_hwp"
        mixed_mode: True이면 혼합 텍스트 모드 (한글 보존)

    Returns:
        변환된 텍스트
    """
    if not text or not text.strip():
        return ""

    if mixed_mode:
        if direction == "hwp_to_latex":
            return convert_hwp_mixed(text)
        else:
            return convert_latex_mixed(text)
    else:
        if direction == "hwp_to_latex":
            return _h2l.convert(text)
        else:
            return _l2h.convert(text)


def convert_batch(lines: list[str], direction: str, mixed_mode: bool = False) -> list[dict]:
    """여러 줄 일괄 변환.

    Args:
        lines: 변환할 텍스트 리스트
        direction: "hwp_to_latex" 또는 "latex_to_hwp"
        mixed_mode: True이면 혼합 텍스트 모드

    Returns:
        [{"input": str, "output": str, "index": int}, ...]
    """
    results = []
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        output = convert_single(line, direction, mixed_mode)
        results.append({
            "input": line,
            "output": output,
            "index": i + 1,
        })
    return results


def convert_file(content: str, direction: str, mixed_mode: bool = False) -> str:
    """파일 내용 전체 변환 (줄 단위).

    Args:
        content: 파일 전체 텍스트
        direction: "hwp_to_latex" 또는 "latex_to_hwp"
        mixed_mode: True이면 혼합 텍스트 모드

    Returns:
        변환된 전체 텍스트 (줄 구분 유지)
    """
    lines = content.split('\n')
    result_lines = []
    for line in lines:
        if line.strip():
            result_lines.append(convert_single(line, direction, mixed_mode))
        else:
            result_lines.append("")
    return '\n'.join(result_lines)
