"""텍스트 유사도 — 문자 n-gram 자카드 (로컬·무료).

생기부 학생 간 표절·복붙 탐지용. 외부 API 불필요.
한글은 공백을 제거하고 3-gram으로 비교(어절 경계에 둔감).
"""

import re

_DEFAULT_N = 3


def char_ngrams(text: str, n: int = _DEFAULT_N) -> set[str]:
    """공백·제어문자 제거 후 문자 n-gram 집합."""
    t = re.sub(r"\s+", "", text or "")
    if len(t) < n:
        return {t} if t else set()
    return {t[i : i + n] for i in range(len(t) - n + 1)}


def jaccard(a: str, b: str, n: int = _DEFAULT_N) -> float:
    """두 텍스트의 n-gram 자카드 유사도 (0~1)."""
    sa = char_ngrams(a, n)
    sb = char_ngrams(b, n)
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def max_pairwise_similarity(
    items: list[tuple[int, str]], n: int = _DEFAULT_N
) -> dict[int, float]:
    """items: [(key, text)]. 각 key에 대해 다른 항목들과의 최대 유사도를 반환.

    O(m^2) — 한 열(한 반 수십 명) 단위라 충분. 전교 단위면 LSH 필요(현재 불필요).
    """
    grams = {k: char_ngrams(t, n) for k, t in items}
    result: dict[int, float] = {k: 0.0 for k, _ in items}
    keys = list(grams.keys())
    for i in range(len(keys)):
        ki = keys[i]
        sa = grams[ki]
        if not sa:
            continue
        for j in range(i + 1, len(keys)):
            kj = keys[j]
            sb = grams[kj]
            if not sb:
                continue
            sim = len(sa & sb) / len(sa | sb)
            if sim > result[ki]:
                result[ki] = sim
            if sim > result[kj]:
                result[kj] = sim
    return result
