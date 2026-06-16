#!/usr/bin/env python3
"""
Mathpix MMD 후처리 — 한국 수학 문서 특화

Mathpix OCR 출력의 한국어 수학 표현 보정:
1. 수학 기호 미감지: "점 A" → "점 $A$", "선분 GH" → "선분 $\\overline{GH}$"
2. 띄어쓰기 오류: "중 심" → "중심"
3. 수학 용어 표준화
"""

import re


# ── 1. 수학 기호 보정 ──
# "점 A", "꼭짓점 B" 등에서 알파벳을 $...$로 감싸기

# 한글 수학 용어 뒤에 오는 알파벳 1~4자를 수식으로 변환
_MATH_LABEL_PATTERNS = [
    # 점 A, 점 B, 꼭짓점 C 등 (1자)
    (re.compile(r'(점|꼭짓점|교점)\s+([A-Z])(?![A-Za-z$])'), r'\1 $\2$'),
    # 선분 AB, 선분 GH (2자 → \overline)
    (re.compile(r'(선분)\s+([A-Z]{2})(?![A-Za-z$])'), r'\1 $\\overline{\2}$'),
    # 직선 AB, 반직선 AB (2자)
    (re.compile(r'(직선|반직선)\s+([A-Z]{2,3})(?![A-Za-z$])'), r'\1 $\2$'),
    # 삼각형 ABC (3자)
    (re.compile(r'(삼각형|△)\s+([A-Z]{3})(?![A-Za-z$])'), r'\1 $\2$'),
    # 사각형 ABCD (4자)
    (re.compile(r'(사각형|직사각형|평행사변형|마름모)\s+([A-Z]{4})(?![A-Za-z$])'), r'\1 $\2$'),
    # 호 AB (2~3자 → \overset{\frown}, KaTeX 호환)
    (re.compile(r'(호)\s+([A-Z]{2,3})(?![A-Za-z$])'), r'\1 $\\overset{\\frown}{\2}$'),
    # 각 A, 각 ABC (단, "각각" "각도" 등은 제외)
    (re.compile(r'(?<!각)(?<!삼)(?<!사)(각)\s+([A-Z]{1,3})(?![A-Za-z$])'), r'\1 $\\angle \2$'),
    # 벡터 a, 벡터 AB
    (re.compile(r'(벡터)\s+([A-Za-z]{1,2})(?![A-Za-z$])'), r'\1 $\\vec{\2}$'),
    # 함수 f, 함수 g (함수명)
    (re.compile(r'(함수)\s+([a-z])(?:\s*\()'), r'\1 $\2$('),
    # 곡선 C, 원 O 등 (도형 이름 1자)
    (re.compile(r'(곡선|원|포물선|타원|쌍곡선)\s+([A-Z])(?![A-Za-z$])'), r'\1 $\2$'),
    # 좌표 A(3, 4) → $A(3, 4)$ — 이미 $ 안에 없는 경우
    (re.compile(r'(?<!\$)([A-Z])\((\s*-?\d+\s*,\s*-?\d+\s*)\)(?!\$)'), r'$\1(\2)$'),
]

def fix_math_labels(text: str) -> str:
    r"""한글 수학 텍스트에서 대문자 알파벳을 수식으로 변환.

    전략: $...$ 밖에 있는 단독 대문자 1~4자를 무조건 $\mathrm{X}$로 감싼다.
    단, 명시적 패턴(선분, 삼각형, 호 등)은 전용 변환을 먼저 적용.
    """
    lines = text.split('\n')
    result = []
    in_display_math = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('$$'):
            if stripped.endswith('$$') and len(stripped) > 4:
                # 한 줄짜리 $$...$$ — display math 상태 변경 없음 (열고 닫기)
                result.append(line)
                continue
            else:
                in_display_math = not in_display_math
                result.append(line)
                continue
        if stripped.endswith('$$') and in_display_math:
            # display math 닫기
            in_display_math = False
            result.append(line)
            continue
        if in_display_math:
            result.append(line)
            continue

        # 1단계: 명시적 패턴 (선분, 삼각형, 호 등)
        processed = line
        for pattern, replacement in _MATH_LABEL_PATTERNS:
            processed = pattern.sub(replacement, processed)

        # 2단계: $...$ 밖의 단독 대문자를 $\mathrm{X}$로 감싸기
        processed = _wrap_bare_uppercase(processed)

        result.append(processed)

    return '\n'.join(result)


def _wrap_bare_uppercase(line: str) -> str:
    """줄에서 $...$ 밖에 있는 단독 대문자 1~4자를 $\\mathrm{X}$로 감싼다.

    "내분하는 점을 D , 점 A 를" → "내분하는 점을 $\\mathrm{D}$ , 점 $A$ 를"
    이미 $로 감싸진 부분은 건드리지 않음.
    """
    # $...$ 구간과 비-수식 구간을 분리
    parts = re.split(r'(\$[^$]*\$)', line)
    # parts: [텍스트, $수식$, 텍스트, $수식$, ...]  (홀수 인덱스가 수식)

    result = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            # $...$ 수식 구간 — 그대로
            result.append(part)
        else:
            # 비-수식 구간 — 단독 대문자 감싸기
            result.append(_replace_bare_letters(part))

    return ''.join(result)


# 단독 대문자 1~4자 패턴: 앞뒤가 대문자가 아닌 경우
# "D"는 잡지만 "Dog", "THE" 같은 영어 단어(소문자 포함)는 스킵
_BARE_UPPER = re.compile(
    r'(?<![A-Za-z$\\])'  # 앞에 영문자, $, \ 없음
    r'([A-Z]{1,4})'      # 대문자 1~4자
    r'(?![A-Za-z${}])'   # 뒤에 영문자, $, {, } 없음
)

# 수식/LaTeX 명령어로 시작하는 것은 제외 (이미 수식 처리됨)
_SKIP_WORDS = {'AND', 'OR', 'NOT', 'THE', 'FOR', 'ALL', 'LET', 'SET'}


def _replace_bare_letters(text: str) -> str:
    """텍스트(비-수식 구간)에서 단독 대문자를 $\\mathrm{X}$로 변환."""

    def _replacer(m):
        letters = m.group(1)
        # 영어 단어(예약어)는 스킵
        if letters in _SKIP_WORDS:
            return m.group(0)
        # 한글 문맥 확인: 주변에 한글이 있는지
        start = m.start()
        end = m.end()
        before_ctx = text[max(0, start - 10):start]
        after_ctx = text[end:min(len(text), end + 10)]
        has_korean = bool(re.search(r'[\uac00-\ud7af]', before_ctx + after_ctx))
        if not has_korean:
            return m.group(0)  # 한글이 없으면 변환 안 함

        return f'$\\mathrm{{{letters}}}$'

    return _BARE_UPPER.sub(_replacer, text)


# ── 2. 띄어쓰기 보정 ──
# Mathpix가 한글 글자 사이에 불필요한 공백을 넣는 경우

_SPACING_FIXES = {
    # 수학 용어
    '중 심': '중심',
    '기 울 기': '기울기',
    '기울 기': '기울기',
    '접 선': '접선',
    '넓 이': '넓이',
    '높 이': '높이',
    '길 이': '길이',
    '지 름': '지름',
    '반지 름': '반지름',
    '반 지 름': '반지름',
    '꼭짓 점': '꼭짓점',
    '꼭 짓 점': '꼭짓점',
    '교 점': '교점',
    '좌 표': '좌표',
    '방정 식': '방정식',
    '방 정 식': '방정식',
    '부등 식': '부등식',
    '함 수': '함수',
    '그래 프': '그래프',
    '미분 계수': '미분계수',
    '적 분': '적분',
    '미 분': '미분',
    '극 대': '극대',
    '극 소': '극소',
    '최 대': '최대',
    '최 소': '최소',
    '수 열': '수열',
    '급 수': '급수',
    '등 차': '등차',
    '등 비': '등비',
    '공 차': '공차',
    '공 비': '공비',
    '확 률': '확률',
    '경우 의 수': '경우의 수',
    '경 우': '경우',
    '평 균': '평균',
    '분 산': '분산',
    '표준 편차': '표준편차',
    '표 준': '표준',
    '편 차': '편차',
    '삼각 형': '삼각형',
    '사각 형': '사각형',
    '직사각 형': '직사각형',
    '평행사변 형': '평행사변형',
    '포물 선': '포물선',
    '쌍곡 선': '쌍곡선',
    '타 원': '타원',
    '정사 영': '정사영',
    '내 적': '내적',
    '외 적': '외적',
    # 일반 용어
    '따라 서': '따라서',
    '그러 므로': '그러므로',
    '그 러 므 로': '그러므로',
    '이 므 로': '이므로',
    '이므 로': '이므로',
    '이 때': '이때',
    '에 서': '에서',
    '이 다': '이다',
}


def fix_spacing(text: str) -> str:
    """한글 수학 용어의 비정상 띄어쓰기 보정."""
    for wrong, correct in _SPACING_FIXES.items():
        text = text.replace(wrong, correct)
    return text


# ── 3. 한글 자모(Jamo) → 호환 자모(Compatibility Jamo) ──
# Mathpix가 ㄱ,ㄴ,ㄷ 등을 Hangul Jamo(U+1100~)로 출력하는 문제
# 한/글 등에서 정상 표시되려면 Compatibility Jamo(U+3131~)여야 함

_JAMO_TO_COMPAT = {
    # 초성 Jamo (U+1100~U+1112) → Compatibility Jamo (U+3131~)
    '\u1100': '\u3131',  # ㄱ
    '\u1101': '\u3132',  # ㄲ
    '\u1102': '\u3134',  # ㄴ
    '\u1103': '\u3137',  # ㄷ
    '\u1104': '\u3138',  # ㄸ
    '\u1105': '\u3139',  # ㄹ
    '\u1106': '\u3141',  # ㅁ
    '\u1107': '\u3142',  # ㅂ
    '\u1108': '\u3143',  # ㅃ
    '\u1109': '\u3145',  # ㅅ
    '\u110A': '\u3146',  # ㅆ
    '\u110B': '\u3147',  # ㅇ
    '\u110C': '\u3148',  # ㅈ
    '\u110D': '\u3149',  # ㅉ
    '\u110E': '\u314A',  # ㅊ
    '\u110F': '\u314B',  # ㅋ
    '\u1110': '\u314C',  # ㅌ
    '\u1111': '\u314D',  # ㅍ
    '\u1112': '\u314E',  # ㅎ
    # 중성 Jamo (U+1161~U+1175) → Compatibility
    '\u1161': '\u314F',  # ㅏ
    '\u1162': '\u3150',  # ㅐ
    '\u1163': '\u3151',  # ㅑ
    '\u1164': '\u3152',  # ㅒ
    '\u1165': '\u3153',  # ㅓ
    '\u1166': '\u3154',  # ㅔ
    '\u1167': '\u3155',  # ㅕ
    '\u1168': '\u3156',  # ㅖ
    '\u1169': '\u3157',  # ㅗ
    '\u116A': '\u3158',  # ㅘ
    '\u116B': '\u3159',  # ㅙ
    '\u116C': '\u315A',  # ㅚ
    '\u116D': '\u315B',  # ㅛ
    '\u116E': '\u315C',  # ㅜ
    '\u116F': '\u315D',  # ㅝ
    '\u1170': '\u315E',  # ㅞ
    '\u1171': '\u315F',  # ㅟ
    '\u1172': '\u3160',  # ㅠ
    '\u1173': '\u3161',  # ㅡ
    '\u1174': '\u3162',  # ㅢ
    '\u1175': '\u3163',  # ㅣ
}

_JAMO_TRANS = str.maketrans(_JAMO_TO_COMPAT)


def fix_jamo(text: str) -> str:
    """Hangul Jamo(U+1100~) → Compatibility Jamo(U+3131~) 변환."""
    return text.translate(_JAMO_TRANS)


# ── 4. 선지 번호 원문자 변환 ──
# "(1)" → "①", "(2)" → "②" 등 — 선지/답안 번호를 원문자로 통일

_CIRCLED_NUMBERS = {
    '1': '①', '2': '②', '3': '③', '4': '④', '5': '⑤',
    '6': '⑥', '7': '⑦', '8': '⑧', '9': '⑨', '10': '⑩',
    '11': '⑪', '12': '⑫', '13': '⑬', '14': '⑭', '15': '⑮',
}

# 줄 시작의 (1), (2)... 선지 번호 패턴
_CHOICE_PREFIX = re.compile(r'^\((\d{1,2})\)\s*')

# 텍스트 중간의 (1), (2)... 참조 번호 패턴 (수식 밖)
_PAREN_NUM = re.compile(r'\((\d{1,2})\)')


def fix_circled_numbers(text: str) -> str:
    """선지/답안 번호 (1)~(15) → ①~⑮ 원문자로 변환.

    - 줄 시작의 (1), (2)... → ① ② (선지 번호)
    - 텍스트 중간의 (1), (2)... → ①② (답안 참조)
    - $...$ 수식 내부는 변환하지 않음
    """
    lines = text.split('\n')
    result = []
    in_display_math = False

    for line in lines:
        stripped = line.strip()
        # display math 블록 ($$ ... $$) 내부는 스킵
        if stripped.startswith('$$'):
            if stripped.endswith('$$') and len(stripped) > 4:
                result.append(line)
                continue
            else:
                in_display_math = not in_display_math
                result.append(line)
                continue
        if stripped.endswith('$$') and in_display_math:
            in_display_math = False
            result.append(line)
            continue
        if in_display_math:
            result.append(line)
            continue

        # $...$ 구간과 비-수식 구간을 분리하여 비-수식 구간만 변환
        parts = re.split(r'(\$[^$]*\$)', line)
        converted = []
        for i, part in enumerate(parts):
            if i % 2 == 1:
                # $...$ 수식 구간 — 그대로
                converted.append(part)
            else:
                # 비-수식 구간 — (N) → ⓝ 변환
                converted.append(_PAREN_NUM.sub(_circled_replacer, part))
        result.append(''.join(converted))

    return '\n'.join(result)


def _circled_replacer(m: re.Match) -> str:
    """(N) → ⓝ 치환 함수."""
    num = m.group(1)
    return _CIRCLED_NUMBERS.get(num, m.group(0))


# ── 4-1. 선지 숫자 수식 변환 ──
# "① 21" "② 28" 등 선지에서 숫자만 있는 경우 $...$로 감싸기

_CHOICE_NUMBER = re.compile(
    r'^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]\s+)'  # 원문자 선지 번호
    r'(-?\d+(?:\.\d+)?)'                       # 숫자 (음수, 소수 포함)
    r'\s*$'                                     # 줄 끝
)


def fix_choice_numbers(text: str) -> str:
    """선지의 단독 숫자를 $...$로 감싸기."""
    lines = text.split('\n')
    result = []
    for line in lines:
        m = _CHOICE_NUMBER.match(line.strip())
        if m:
            prefix = m.group(1)
            number = m.group(2)
            result.append(f'{prefix}${number}$')
        else:
            result.append(line)
    return '\n'.join(result)


# ── 5. 통합 후처리 ──

def postprocess_mmd(text: str) -> str:
    """Mathpix MMD 출력을 한국 수학 문서에 맞게 후처리.

    사용법:
        from postprocess import postprocess_mmd
        cleaned = postprocess_mmd(raw_mmd)
    """
    text = fix_jamo(text)
    text = fix_spacing(text)
    text = fix_math_labels(text)
    text = fix_circled_numbers(text)
    text = fix_choice_numbers(text)
    return text
