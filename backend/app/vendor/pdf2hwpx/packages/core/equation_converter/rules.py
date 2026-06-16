#!/usr/bin/env python3
"""
규칙 기반 HWP ↔ LaTeX 변환기

HWP 수식 스크립트와 LaTeX 간의 양방향 규칙 기반 변환을 수행합니다.
T5 모델의 폴백 또는 단순 수식의 직접 변환에 사용됩니다.

Usage:
    from rules import HwpToLatexRules, LatexToHwpRules

    h2l = HwpToLatexRules()
    result = h2l.convert("{1} over {2}")  # → "\\frac{1}{2}"

    l2h = LatexToHwpRules()
    result = l2h.convert("\\frac{1}{2}")  # → "{1} over {2}"
"""

import re


# ── 공통 매핑 테이블 ──

# HWP 대문자 키워드 → LaTeX 명령어
OPERATOR_MAP = {
    # 기본 연산자
    "TIMES": r"\times",
    "CDOT": r"\cdot",
    "DIV": r"\div",
    "PM": r"\pm",
    "MP": r"\mp",
    # 비교 연산자
    "LEQ": r"\leq",
    "GEQ": r"\geq",
    "NEQ": r"\neq",
    "APPROX": r"\approx",
    "EQUIV": r"\equiv",
    "SIM": r"\sim",
    "PROPTO": r"\propto",
    "PREC": r"\prec",
    # 무한대
    "INFTY": r"\infty",
    "INFINITY": r"\infty",
    "INF": r"\infty",
    # 논리
    "THEREFORE": r"\therefore",
    "BECAUSE": r"\because",
    "FORALL": r"\forall",
    "EXISTS": r"\exists",
    # 집합
    "IN": r"\in",
    "NOTIN": r"\notin",
    "SUBSET": r"\subset",
    "SUPSET": r"\supset",
    "SUBSETEQ": r"\subseteq",
    "SUPSETEQ": r"\supseteq",
    "CUP": r"\cup",
    "CAP": r"\cap",
    "EMPTYSET": r"\emptyset",
    # 미적분/벡터
    "NABLA": r"\nabla",
    "PARTIAL": r"\partial",
    # 기하
    "ANGLE": r"\angle",
    "PERP": r"\perp",
    "PARALLEL": r"\parallel",
    "TRIANGLE": r"\triangle",
    "CIRC": r"\circ",
    "BOX": r"\square",
    "DEG": r"^{\circ}",
    # 점 기호
    "CDOTS": r"\cdots",
    "LDOTS": r"\ldots",
    "VDOTS": r"\vdots",
    "DDOTS": r"\ddots",
    # 화살표
    "RIGHTARROW": r"\rightarrow",
    "LEFTARROW": r"\leftarrow",
    "LEFTRIGHTARROW": r"\leftrightarrow",
    "DBLRIGHTARROW": r"\Rightarrow",
    "DBLLEFTARROW": r"\Leftarrow",
    "DBLLEFTRIGHTARROW": r"\Leftrightarrow",
    "UPARROW": r"\uparrow",
    "DOWNARROW": r"\downarrow",
    "OVERRIGHTARROW": r"\overrightarrow",
    "OVERLEFTARROW": r"\overleftarrow",
    "SEARROW": r"\searrow",
    "NEARROW": r"\nearrow",
    "SWARROW": r"\swarrow",
    "NWARROW": r"\nwarrow",
    # 구분자
    "VERT": r"\vert",
    "DBLVERT": r"\|",
    "MID": r"\mid",
    # 기타
    "BULLET": r"\bullet",
}

# 소문자 HWP 키워드 별칭 → LaTeX (데이터에 소문자가 다수 존재)
OPERATOR_MAP_LOWER = {
    "le": r"\leq",
    "ge": r"\geq",
    "ne": r"\neq",
    "times": r"\times",
    "therefore": r"\therefore",
    "because": r"\because",
    "infty": r"\infty",
    "cdots": r"\cdots",
    "ldots": r"\ldots",
    "vdots": r"\vdots",
    "ddots": r"\ddots",
    "circ": r"\circ",
    "triangle": r"\triangle",
    "angle": r"\angle",
    "perp": r"\perp",
    "parallel": r"\parallel",
    "nabla": r"\nabla",
    "partial": r"\partial",
    "approx": r"\approx",
    "equiv": r"\equiv",
    "sim": r"\sim",
    "propto": r"\propto",
    "forall": r"\forall",
    "exists": r"\exists",
    "emptyset": r"\emptyset",
    "subset": r"\subset",
    "supset": r"\supset",
    "cup": r"\cup",
    "cap": r"\cap",
    "pm": r"\pm",
    "mp": r"\mp",
    "div": r"\div",
    "cdot": r"\cdot",
    "rightarrow": r"\rightarrow",
    "leftarrow": r"\leftarrow",
    "leftrightarrow": r"\leftrightarrow",
    "uparrow": r"\uparrow",
    "downarrow": r"\downarrow",
    "vert": r"\vert",
    "mid": r"\mid",
    "bullet": r"\bullet",
}

# LaTeX → HWP 역변환용 별도 매핑 (소문자 출력 선호)
L2H_OPERATOR_MAP = {
    # 기본 연산자
    r"\times": "TIMES",
    r"\cdot": "CDOT",
    r"\div": "DIVIDE",
    r"\pm": "+-",
    r"\mp": "-+",
    # 비교/부등식
    r"\leq": "LEQ",
    r"\geq": "GEQ",
    r"\neq": "!=",
    r"\approx": "APPROX",
    r"\equiv": "IDENTICAL",
    r"\sim": "SIM",
    r"\propto": "PROPTO",
    r"\prec": "PREC",
    r"\succ": "SUCC",
    r"\cong": "CONG",
    r"\simeq": "SIMEQ",
    r"\asymp": "ASYMP",
    r"\doteq": "DOTEQ",
    r"\ll": "<<",
    r"\gg": ">>",
    # 무한대
    r"\infty": "INF",
    # 논리
    r"\therefore": "THEREFORE",
    r"\because": "BECAUSE",
    r"\forall": "FORALL",
    r"\exists": "EXIST",
    r"\neg": "LNOT",
    r"\lnot": "LNOT",
    r"\lor": "LOR",
    r"\vee": "LOR",
    r"\land": "WEDGE",
    r"\wedge": "WEDGE",
    # 집합
    r"\in": "IN",
    r"\ni": "OWNS",
    r"\owns": "OWNS",
    r"\notin": "NOTIN",
    r"\subset": "SUBSET",
    r"\supset": "SUPERSET",
    r"\subseteq": "SUBSETEQ",
    r"\supseteq": "SUPSETEQ",
    r"\sqsubset": "SQSUBSET",
    r"\sqsupset": "SQSUPSET",
    r"\sqsubseteq": "SQSUBSETEQ",
    r"\sqsupseteq": "SQSUPSETEQ",
    r"\sqcap": "SQCAP",
    r"\sqcup": "SQCUP",
    r"\cup": "CUP",
    r"\cap": "CAP",
    r"\emptyset": "EMPTYSET",
    r"\varnothing": "EMPTYSET",
    r"\oplus": "DSUM",
    r"\ominus": "OMINUS",
    r"\otimes": "OTIMES",
    r"\oslash": "ODIV",
    r"\odot": "ODOT",
    r"\uplus": "UPLUS",
    # 미적분/벡터
    r"\nabla": "NABLA",
    r"\partial": "Partial",
    # 기하/기호
    r"\angle": "ANGLE",
    r"\perp": "BOT",
    r"\parallel": "PARALLEL",
    r"\triangle": "TRIANGLE",
    r"\circ": "CIRC",
    r"\square": "BOX",
    r"^{\circ}": "DEG",
    r"\diamond": "DIAMOND",
    r"\bigcirc": "BIGCIRC",
    r"\ast": "AST",
    r"\star": "STAR",
    # 점 기호
    r"\cdots": "CDOTS",
    r"\ldots": "LDOTS",
    r"\vdots": "VDOTS",
    r"\ddots": "DDOTS",
    # 화살표 (단일 = 소문자)
    r"\rightarrow": "rarrow",
    r"\leftarrow": "larrow",
    r"\leftrightarrow": "lrarrow",
    r"\uparrow": "uparrow",
    r"\downarrow": "downarrow",
    r"\updownarrow": "udarrow",
    r"\to": "rarrow",
    # 화살표 (이중 = 대문자)
    r"\Rightarrow": "RARROW",
    r"\Leftarrow": "LARROW",
    r"\Leftrightarrow": "LRARROW",
    r"\Uparrow": "UPARROW",
    r"\Downarrow": "DOWNARROW",
    r"\Updownarrow": "UDARROW",
    # 화살표 (대각선)
    r"\searrow": "SEARROW",
    r"\nearrow": "NEARROW",
    r"\swarrow": "SWARROW",
    r"\nwarrow": "NWARROW",
    # 화살표 (기타)
    r"\hookrightarrow": "HOOKRIGHT",
    r"\hookleftarrow": "HOOKLEFT",
    r"\mapsto": "MAPSTO",
    r"\overrightarrow": "OVERRIGHTARROW",
    r"\overleftarrow": "OVERLEFTARROW",
    # 구분자
    r"\vert": "vert",
    r"\mid": "vert",
    r"\|": "PVER",
    # 관계
    r"\vdash": "VDASH",
    r"\dashv": "DASHV",
    r"\bot": "BOT",
    r"\top": "TOP",
    r"\models": "MODELS",
    # 특수 문자
    r"\aleph": "ALEPH",
    r"\hbar": "hbar",
    r"\imath": "imath",
    r"\jmath": "jmath",
    r"\ell": "LITER",
    r"\wp": "WP",
    r"\Im": "IMAG",
    # 기타
    r"\bullet": "BULLET",
    r"\prime": "prime",
    r"\dagger": "DAGGER",
    r"\ddagger": "DDAGGER",
}

# 소문자 그리스 문자 (word boundary 매칭 필요)
GREEK_LOWER = [
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
    "zeta", "eta", "theta", "vartheta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "omicron", "pi", "varpi",
    "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega",
]

# 대문자 그리스 문자
GREEK_UPPER = [
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi",
    "Sigma", "Upsilon", "Phi", "Psi", "Omega",
]

# 수학 함수 (word boundary 매칭)
MATH_FUNCTIONS = [
    "sin", "cos", "tan", "cot", "sec", "csc",
    "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "coth",
    "log", "ln", "exp",
    "lim", "limsup", "liminf",
    "max", "min", "sup", "inf",
    "det", "dim", "ker", "deg",
    "gcd", "hom", "arg",
]

# 큰 연산자 (LaTeX 이름)
BIG_OPERATORS = [
    "sum", "prod", "coprod",
    "int", "iint", "iiint", "oint", "oiint", "oiiint",
    "bigcup", "bigcap", "bigsqcup", "bigsqcap",
    "bigoplus", "bigotimes", "bigodot", "biguplus",
    "bigvee", "bigwedge",
]

# 모든 알려진 HWP 키워드 (전처리에서 붙은 키워드 분리에 사용)
# 긴 것부터 매칭하기 위해 사용 시 정렬 필요
ALL_HWP_KEYWORDS = (
    # 대문자 연산자
    list(OPERATOR_MAP.keys())
    # 소문자 연산자 별칭
    + list(OPERATOR_MAP_LOWER.keys())
    # 그리스 문자
    + GREEK_LOWER + GREEK_UPPER
    # 수학 함수
    + MATH_FUNCTIONS
    # 큰 연산자
    + BIG_OPERATORS + [op.upper() for op in BIG_OPERATORS]
    # 구조 키워드
    + ["over", "OVER", "sqrt", "SQRT", "root", "ROOT",
       "LEFT", "RIGHT", "MATRIX", "CASES", "PMATRIX", "DMATRIX"]
)
# 중복 제거 + 길이순 정렬 (긴 것부터 매칭)
ALL_HWP_KEYWORDS_SORTED = sorted(set(ALL_HWP_KEYWORDS), key=len, reverse=True)

# 장식 기호 (HWP hat/bar/dot 등)
DECORATIONS_H2L = {
    "hat": r"\hat",
    "HAT": r"\hat",
    "bar": r"\bar",
    "BAR": r"\bar",
    "dot": r"\dot",
    "DOT": r"\dot",
    "ddot": r"\ddot",
    "DDOT": r"\ddot",
    "tilde": r"\tilde",
    "TILDE": r"\tilde",
    "vec": r"\vec",
    "VEC": r"\vec",
    "check": r"\check",
    "CHECK": r"\check",
    "arch": r"\breve",
    "ARCH": r"\breve",
    "acute": r"\acute",
    "ACUTE": r"\acute",
    "grave": r"\grave",
    "GRAVE": r"\grave",
    "dyad": r"\overleftrightarrow",
    "DYAD": r"\overleftrightarrow",
    "under": r"\underline",
    "UNDER": r"\underline",
    "overline": r"\overline",
    "OVERLINE": r"\overline",
    "underline": r"\underline",
    "UNDERLINE": r"\underline",
}

# LEFT/RIGHT 구분자 매핑
DELIMITERS_H2L = {
    "(": r"\left(",
    ")": r"\right)",
    "[": r"\left[",
    "]": r"\right]",
    "{": r"\left\{",
    "}": r"\right\}",
    "|": None,  # 컨텍스트 따라 left/right 결정
    "langle": r"\left\langle",
    "rangle": r"\right\rangle",
}


def _find_matching_brace(text, start):
    """중괄호 짝 찾기. text[start] == '{' 가정. 짝 닫는 위치 반환, 못 찾으면 -1."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _extract_braced_arg(text, pos):
    """pos 위치부터 {arg} 추출. 반환: (arg_content, end_pos) 또는 (None, pos)."""
    # 공백 스킵
    i = pos
    while i < len(text) and text[i] in ' \t':
        i += 1
    if i >= len(text) or text[i] != '{':
        return None, pos
    end = _find_matching_brace(text, i)
    if end == -1:
        return None, pos
    return text[i + 1:end], end + 1


class HwpToLatexRules:
    """HWP 수식 스크립트 → LaTeX 규칙 기반 변환기"""

    def convert(self, text: str) -> str:
        """HWP 수식을 LaTeX로 변환"""
        result = text

        # Phase 1: 전처리
        result = self._preprocess(result)

        # Phase 2: 구조적 변환 (재귀)
        result = self._convert_over(result)
        result = self._convert_binom(result)
        result = self._convert_left_right(result)
        result = self._convert_cases(result)
        result = self._convert_matrix(result)
        result = self._convert_pile(result)
        result = self._convert_sqrt(result)
        result = self._convert_decorations(result)

        # Phase 3: 키워드 변환
        result = self._convert_operators(result)
        result = self._convert_big_operators(result)
        result = self._convert_math_functions(result)
        result = self._convert_greek(result)

        # Phase 4: 공백/포맷 정리
        result = self._fix_sub_sup_spacing(result)
        result = self._postprocess(result)

        return result

    def _preprocess(self, text: str) -> str:
        """전처리: 백틱 제거, 틸드→공백, 마커 제거, 붙은 키워드 분리, 공백 정규화"""
        # 백틱 제거
        text = text.replace('`', '')
        # 틸드 → 공백 (HWP에서 ~는 1em 공백)
        text = text.replace('~', ' ')
        # HWP 폰트 명령 → LaTeX 폰트 명령
        # rm{X} 또는 rm X → \mathrm{X}
        text = re.sub(r'\brm\s*\{([^{}]*)\}', r'\\mathrm{\1}', text)
        text = re.sub(r'\bbf\s*\{([^{}]*)\}', r'\\mathbf{\1}', text)
        text = re.sub(r'\bsf\s*\{([^{}]*)\}', r'\\mathsf{\1}', text)
        text = re.sub(r'\bit\s*\{([^{}]*)\}', r'\\mathit{\1}', text)
        # rm X (단일 토큰, 중괄호 없음) → \mathrm{X}
        text = re.sub(r'\brm\s+([A-Z])(?![a-zA-Z])', r'\\mathrm{\1}', text)
        text = re.sub(r'\bbf\s+([A-Z])(?![a-zA-Z])', r'\\mathbf{\1}', text)
        text = re.sub(r'\bsf\s+([A-Z])(?![a-zA-Z])', r'\\mathsf{\1}', text)
        # 나머지 rm/it (폰트 전환만 하는 경우) 제거
        text = re.sub(r'\brm\b\s*', '', text)
        text = re.sub(r'\bit\b\s*', '', text)
        # 붙은 키워드 분리: 'LEQt' → 'LEQ t', 'cdotscdots' → 'cdots cdots'
        # 키워드가 다른 영숫자에 붙어있는 경우 공백으로 분리
        text = self._separate_stuck_keywords(text)
        # == → EQUIV (이중 등호 = 합동)
        text = text.replace('==', ' EQUIV ')
        # (mod X) → \\bmod X (괄호 밖에서 처리)
        text = re.sub(r'\(\s*mod\s+([^)]+)\)', r'(\\bmod \1)', text)
        # 연속 공백 → 단일 공백
        text = re.sub(r'[ \t]+', ' ', text)
        return text.strip()

    def _separate_stuck_keywords(self, text: str) -> str:
        """숫자 바로 뒤에 붙은 키워드를 공백으로 분리

        예: '3pi' → '3 pi', '2theta' → '2 theta', '10alpha' → '10 alpha'
        주의: 키워드-키워드 분리(cdotscdots)는 오분리 위험이 높아 미처리.
        (CDOTS에서 CDOT을 분리하는 등의 부작용 방지)
        """
        for kw in ALL_HWP_KEYWORDS_SORTED:
            if len(kw) < 2:
                continue
            # 숫자 바로 뒤에 키워드가 붙은 경우만 분리
            # 키워드 뒤에는 word boundary가 있어야 함 (키워드가 더 긴 단어의 일부가 아닌 경우)
            text = re.sub(
                r'(?<=\d)(' + re.escape(kw) + r')(?![a-zA-Z])',
                r' \1', text
            )
        return text

    def _convert_over(self, text: str) -> str:
        """재귀적 {a} over {b} → \\frac{a}{b} 변환"""
        # 대소문자 모두 처리
        pattern = r'\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}\s*(?:over|OVER)\s*\{([^{}]*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}[^{}]*)*)\}'

        max_iter = 20
        for _ in range(max_iter):
            new_text = re.sub(pattern, '\\\\frac{\\1}{\\2}', text)
            if new_text == text:
                break
            text = new_text

        return text

    def _convert_binom(self, text: str) -> str:
        """LEFT ( pile{A#B} RIGHT ) → \\binom{A}{B} (이항계수)

        pile이 정확히 2행이고 LEFT ( ... RIGHT ) 안에 있을 때만 변환.
        """
        # 패턴: LEFT ( pile{...} RIGHT )
        pattern = re.compile(
            r'\bLEFT\s*\(\s*pile\s*\{', re.IGNORECASE
        )
        while True:
            m = pattern.search(text)
            if not m:
                break
            # pile{ 위치 찾기
            brace_start = text.index('{', m.start())
            brace_end = _find_matching_brace(text, brace_start)
            if brace_end == -1:
                break
            inner = text[brace_start + 1:brace_end]
            # pile 내용을 # 으로 분리
            rows = self._split_top_level(inner, '#')
            # 뒤에 RIGHT ) 가 있는지 확인
            after = text[brace_end + 1:].lstrip()
            right_m = re.match(r'RIGHT\s*\)', after, re.IGNORECASE)
            if not right_m:
                break
            right_end = brace_end + 1 + (len(text[brace_end + 1:]) - len(after)) + right_m.end()
            if len(rows) == 2:
                # 이항계수: \binom{A}{B}
                replacement = '\\binom{' + rows[0].strip() + '}{' + rows[1].strip() + '}'
            else:
                # 2행이 아니면 그냥 \left( ... \right) 유지
                break
            text = text[:m.start()] + replacement + text[right_end:]
        return text

    def _convert_left_right(self, text: str) -> str:
        """LEFT/RIGHT 구분자 변환"""
        # LEFT ( → \left(
        text = re.sub(r'\bLEFT\s*\(\s*', '\\\\left( ', text)
        text = re.sub(r'\bLEFT\s*\[\s*', '\\\\left[ ', text)
        text = re.sub(r'\bLEFT\s*\|\s*', '\\\\left| ', text)
        text = re.sub(r'\bLEFT\s*\\\{\s*', '\\\\left\\\\{ ', text)
        text = re.sub(r'\bLEFT\s*\{\s*', '\\\\left\\\\{ ', text)
        text = re.sub(r'\bLEFT\s*<\s*', '\\\\left\\\\langle ', text)
        text = re.sub(r'\bLEFT\s*langle\s*', '\\\\left\\\\langle ', text)
        # LEFT . (invisible delimiter)
        text = re.sub(r'\bLEFT\s*\.\s*', '\\\\left. ', text)

        # RIGHT ) → \right)
        text = re.sub(r'\bRIGHT\s*\)\s*', '\\\\right) ', text)
        text = re.sub(r'\bRIGHT\s*\]\s*', '\\\\right] ', text)
        text = re.sub(r'\bRIGHT\s*\|\s*', '\\\\right| ', text)
        text = re.sub(r'\bRIGHT\s*\\\}\s*', '\\\\right\\\\} ', text)
        text = re.sub(r'\bRIGHT\s*\}\s*', '\\\\right\\\\} ', text)
        text = re.sub(r'\bRIGHT\s*>\s*', '\\\\right\\\\rangle ', text)
        text = re.sub(r'\bRIGHT\s*rangle\s*', '\\\\right\\\\rangle ', text)
        text = re.sub(r'\bRIGHT\s*\.\s*', '\\\\right. ', text)

        return text

    def _convert_cases(self, text: str) -> str:
        """cases{...} → \\begin{cases}...\\end{cases}

        HWP cases 구조:
          cases{pile{val1#val2}&pile{cond1#cond2}#val3&cond3}
        → \\begin{cases} val1 & cond1 \\\\ val2 & cond2 \\\\ val3 & cond3 \\end{cases}

        pile 내부의 #은 줄바꿈, 최상위 #도 줄바꿈, &는 열 구분.
        pile이 여러 열에 있으면 "unzip"하여 행으로 펼침.
        """
        pattern = re.compile(r'\bcases\b\s*\{', re.IGNORECASE)
        while True:
            m = pattern.search(text)
            if not m:
                break
            brace_start = m.end() - 1
            brace_end = _find_matching_brace(text, brace_start)
            if brace_end == -1:
                break
            inner = text[brace_start + 1:brace_end]

            rows = self._expand_cases_content(inner)
            latex_rows = ' \\\\ '.join(rows)
            replacement = '\\begin{cases} ' + latex_rows + ' \\end{cases}'
            text = text[:m.start()] + replacement + text[brace_end + 1:]
        return text

    def _expand_cases_content(self, content: str) -> list:
        """cases 내부 콘텐츠를 LaTeX 행 리스트로 펼침.

        1. 최상위 #으로 행 분리
        2. 각 행에서 &로 열 분리
        3. pile{a#b}가 있으면 unzip하여 여러 행으로 확장
        """
        top_rows = self._split_top_level(content, '#')
        result_rows = []

        for row in top_rows:
            row = row.strip()
            if not row:
                continue
            cols = self._split_top_level(row, '&')

            # 각 열에서 pile 확인 및 추출
            col_lines = []
            max_lines = 1
            for col in cols:
                col = col.strip()
                pile_m = re.match(r'^\s*pile\s*\{', col, re.IGNORECASE)
                if pile_m:
                    brace_start = col.index('{', pile_m.start())
                    brace_end = _find_matching_brace(col, brace_start)
                    if brace_end != -1:
                        pile_content = col[brace_start + 1:brace_end]
                        lines = self._split_top_level(pile_content, '#')
                        col_lines.append([l.strip() for l in lines])
                        max_lines = max(max_lines, len(lines))
                    else:
                        col_lines.append([col])
                else:
                    col_lines.append([col])

            # Unzip: 여러 pile 열을 행으로 펼침
            for i in range(max_lines):
                parts = []
                for cl in col_lines:
                    if i < len(cl):
                        parts.append(cl[i])
                    else:
                        parts.append('')
                result_rows.append(' & '.join(parts))

        return result_rows

    def _split_top_level(self, text: str, sep: str) -> list:
        """중괄호 깊이를 고려하여 최상위 레벨에서만 sep으로 분리"""
        parts = []
        depth = 0
        current = []
        for ch in text:
            if ch == '{':
                depth += 1
                current.append(ch)
            elif ch == '}':
                depth -= 1
                current.append(ch)
            elif ch == sep and depth == 0:
                parts.append(''.join(current))
                current = []
            else:
                current.append(ch)
        parts.append(''.join(current))
        return parts

    def _convert_matrix(self, text: str) -> str:
        """matrix{...}, pmatrix{...}, dmatrix{...} → LaTeX matrix 환경

        HWP: matrix{a&b#c&d}  →  \\begin{matrix} a & b \\\\ c & d \\end{matrix}
        pmatrix → \\begin{pmatrix}...  dmatrix → \\begin{vmatrix}...
        """
        env_map = {
            'matrix': 'matrix',
            'MATRIX': 'matrix',
            'pmatrix': 'pmatrix',
            'PMATRIX': 'pmatrix',
            'dmatrix': 'vmatrix',
            'DMATRIX': 'vmatrix',
            'bmatrix': 'bmatrix',
            'BMATRIX': 'bmatrix',
        }
        for hwp_kw, latex_env in env_map.items():
            pattern = re.compile(r'\b' + re.escape(hwp_kw) + r'\s*\{')
            while True:
                m = pattern.search(text)
                if not m:
                    break
                brace_start = m.end() - 1
                brace_end = _find_matching_brace(text, brace_start)
                if brace_end == -1:
                    break
                inner = text[brace_start + 1:brace_end]
                # # → \\ (행 구분), & → & with spaces
                inner = inner.replace('#', ' \\\\ ')
                inner = re.sub(r'\s*&\s*', ' & ', inner)
                replacement = '\\begin{' + latex_env + '} ' + inner + ' \\end{' + latex_env + '}'
                text = text[:m.start()] + replacement + text[brace_end + 1:]
        return text

    def _convert_pile(self, text: str) -> str:
        """독립적인 pile{a#b#c} → a \\\\ b \\\\ c (cases/matrix 외부에서 사용)"""
        pattern = re.compile(r'\bpile\b\s*\{', re.IGNORECASE)
        while True:
            m = pattern.search(text)
            if not m:
                break
            brace_start = m.end() - 1
            brace_end = _find_matching_brace(text, brace_start)
            if brace_end == -1:
                break
            inner = text[brace_start + 1:brace_end]
            inner = inner.replace('#', ' \\\\ ')
            text = text[:m.start()] + inner + text[brace_end + 1:]
        return text

    def _convert_sqrt(self, text: str) -> str:
        """SQRT/sqrt 변환 (중괄호 있는 경우 + 단일 토큰 인자)"""
        # SQRT{x} → \sqrt{x}
        text = re.sub(r'\b(?:SQRT|sqrt)\s*\{', '\\\\sqrt{', text)
        # ROOT n of {x} → \sqrt[n]{x}  (n차 근호, "of" 키워드 포함)
        text = re.sub(r'\b(?:ROOT|root)\s+(\d+)\s+of\s*\{', '\\\\sqrt[\\1]{', text)
        # ROOT n of x → \sqrt[n]{x}  (단일 토큰, "of" 키워드 포함)
        text = re.sub(r'\b(?:ROOT|root)\s+(\d+)\s+of\s+([a-zA-Z0-9])\b', r'\\sqrt[\1]{\2}', text)
        # ROOT n {x} → \sqrt[n]{x}  (n차 근호, "of" 없이)
        text = re.sub(r'\b(?:ROOT|root)\s+(\d+)\s*\{', '\\\\sqrt[\\1]{', text)
        # sqrt 3 → \sqrt{3}, sqrt x → \sqrt{x} (중괄호 없이 단일 토큰)
        text = re.sub(r'\b(?:SQRT|sqrt)\s+([a-zA-Z0-9])\b', r'\\sqrt{\1}', text)
        return text

    def _convert_decorations(self, text: str) -> str:
        """장식 기호 변환: hat{x} → \\hat{x}, hat x → \\hat{x}"""
        for hwp_key, latex_cmd in DECORATIONS_H2L.items():
            # 중괄호 있는 경우: hat{x} → \hat{x}
            pattern = r'\b' + re.escape(hwp_key) + r'\s*\{'
            replacement = latex_cmd.replace('\\', '\\\\') + '{'
            text = re.sub(pattern, replacement, text)
        # 중괄호 없이 단일 토큰: hat x → \hat{x}, bar a → \bar{a} 등
        for hwp_key in ("hat", "HAT", "bar", "BAR", "vec", "VEC",
                        "dot", "DOT", "tilde", "TILDE", "ddot", "DDOT"):
            latex_cmd = DECORATIONS_H2L.get(hwp_key, "")
            if latex_cmd:
                repl = latex_cmd.replace('\\', '\\\\')
                text = re.sub(
                    r'\b' + re.escape(hwp_key) + r'\s+([a-zA-Z0-9])\b',
                    repl + r'{\1}', text
                )
        return text

    def _convert_operators(self, text: str) -> str:
        """대문자 + 소문자 키워드 연산자 변환"""
        # 대문자 키워드 (긴 것부터 매칭 — SUBSETEQ > SUBSET 등)
        for hwp_op, latex_op in sorted(OPERATOR_MAP.items(), key=lambda x: -len(x[0])):
            repl = latex_op.replace('\\', '\\\\')
            text = re.sub(r'(?<![a-zA-Z])' + hwp_op + r'(?![a-zA-Z])', repl, text)
        # 소문자 키워드 별칭 (긴 것부터)
        for hwp_op, latex_op in sorted(OPERATOR_MAP_LOWER.items(), key=lambda x: -len(x[0])):
            repl = latex_op.replace('\\', '\\\\')
            text = re.sub(r'(?<![\\a-zA-Z])' + hwp_op + r'(?![a-zA-Z])', repl, text)
        return text

    def _convert_big_operators(self, text: str) -> str:
        """큰 연산자 변환 (sum, int 등)"""
        for op in BIG_OPERATORS:
            repl = '\\\\' + op
            text = re.sub(r'(?<![\\a-zA-Z])' + op + r'(?![a-zA-Z])', repl, text)
            text = re.sub(r'(?<![a-zA-Z])' + op.upper() + r'(?![a-zA-Z])', repl, text)
        return text

    def _convert_math_functions(self, text: str) -> str:
        """수학 함수 변환"""
        for func in MATH_FUNCTIONS:
            pattern = r'(?<![\\a-zA-Z])' + func + r'(?![a-zA-Z])'
            repl = '\\\\' + func
            text = re.sub(pattern, repl, text)
        return text

    def _convert_greek(self, text: str) -> str:
        """그리스 문자 변환"""
        # 소문자 그리스 문자 (긴 것부터 매칭)
        # \b 대신 (?<![\\a-zA-Z])...(?![a-zA-Z]) 사용 — v_theta 등에서 _ 뒤 매칭 가능
        for letter in sorted(GREEK_LOWER, key=len, reverse=True):
            pattern = r'(?<![\\a-zA-Z])' + letter + r'(?![a-zA-Z])'
            repl = '\\\\' + letter
            text = re.sub(pattern, repl, text)

        # 대문자 그리스 문자
        for letter in sorted(GREEK_UPPER, key=len, reverse=True):
            pattern = r'(?<![\\a-zA-Z])' + letter + r'(?![a-zA-Z])'
            repl = '\\\\' + letter
            text = re.sub(pattern, repl, text)

        return text

    def _fix_sub_sup_spacing(self, text: str) -> str:
        """아래첨자/위첨자 앞 공백 제거: a _{n} → a_{n}, x ^{2} → x^{2}"""
        text = re.sub(r'\s+_\s*\{', '_{', text)
        text = re.sub(r'\s+\^\s*\{', '^{', text)
        # 첨자 뒤 불필요한 공백도 처리
        text = re.sub(r'_\s+\{', '_{', text)
        text = re.sub(r'\^\s+\{', '^{', text)
        return text

    def _postprocess(self, text: str) -> str:
        """후처리: 공백 정리"""
        # 잔여 # (HWP 줄바꿈, cases/pile/matrix에서 미처리된 것) → \\ (LaTeX 줄바꿈)
        text = text.replace('#', ' \\\\ ')
        # 다문자 첨자 중괄호 감싸기: _\theta → _{\theta}, ^\alpha → ^{\alpha}
        text = re.sub(r'([_^])(\\[a-zA-Z]+)', r'\1{\2}', text)
        # 연속 공백 정리
        text = re.sub(r'[ \t]+', ' ', text)
        # \frac 바로 뒤 공백 제거
        text = text.replace('\\frac {', '\\frac{')
        # \left( / \right) 뒤/앞 불필요한 공백 제거
        text = re.sub(r'\\left\(\s+', r'\\left(', text)
        text = re.sub(r'\\left\[\s+', r'\\left[', text)
        text = re.sub(r'\s+\\right\)', r'\\right)', text)
        text = re.sub(r'\s+\\right\]', r'\\right]', text)
        # \sqrt 뒤 공백 제거
        text = re.sub(r'\\sqrt\s+\{', r'\\sqrt{', text)
        text = re.sub(r'\\sqrt\s+\[', r'\\sqrt[', text)
        # 마지막 정리
        text = text.strip()
        return text


class LatexToHwpRules:
    """LaTeX → HWP 수식 스크립트 규칙 기반 변환기"""

    def convert(self, text: str) -> str:
        """LaTeX 수식을 HWP 스크립트로 변환"""
        result = text

        # Phase 1: 전처리
        result = self._preprocess(result)

        # Phase 2: 구조적 역변환
        result = self._convert_binom(result)
        result = self._convert_environments(result)
        result = self._convert_frac(result)
        result = self._convert_left_right(result)
        result = self._convert_sqrt(result)
        result = self._convert_decorations(result)

        # Phase 3: 키워드 역변환
        result = self._convert_operators(result)
        result = self._convert_big_operators(result)
        result = self._convert_math_functions(result)
        result = self._convert_greek(result)

        # Phase 4: 후처리
        result = self._add_sub_sup_spacing(result)
        result = self._postprocess(result)

        return result

    def _preprocess(self, text: str) -> str:
        """전처리: LaTeX 환경/명령 제거, 공백 정규화"""
        # \quad, \qquad → 공백
        text = re.sub(r'\\qquad\b', ' ', text)
        text = re.sub(r'\\quad\b', ' ', text)
        # \text{} 처리: 한글 포함 시 큰따옴표로 감싸기 (한컴 수식 요구)
        def _text_repl(m):
            content = m.group(1)
            # 한글(가-힣) 포함 여부
            if re.search(r'[\uac00-\ud7af]', content):
                return f'"{content.strip()}"'
            return content
        text = re.sub(r'\\text\s*\{([^{}]*)\}', _text_repl, text)
        text = re.sub(r'\\mathrm\{([^{}]*)\}', r'rm \1', text)
        text = re.sub(r'\\mathbf\{([^{}]*)\}', r'bf \1', text)
        text = re.sub(r'\\mathit\{([^{}]*)\}', r'it \1', text)
        text = re.sub(r'\\mathsf\{([^{}]*)\}', r'sf \1', text)
        # \mathcal{X} → X (HWP에는 calligraphic 폰트 없음, 그냥 문자로)
        text = re.sub(r'\\mathcal\{([^{}]*)\}', r'\1', text)
        # \mathbb{X} → X (블랙보드 볼드도 없음)
        text = re.sub(r'\\mathbb\{([^{}]*)\}', r'\1', text)
        # \prime → '
        text = text.replace(r'\prime', "'")
        # LaTeX 명령 별칭 통일 (연산자 변환 전에 처리)
        text = text.replace(r'\leqq', r'\leq')
        text = text.replace(r'\geqq', r'\geq')
        text = re.sub(r'\\ne(?![a-zA-Z])', r'\\neq', text)
        # \pmod{X} → (mod X)
        text = re.sub(r'\\pmod\{([^{}]*)\}', r'(mod \1)', text)
        # \bmod → mod
        text = text.replace(r'\bmod', 'mod')
        # \equiv는 L2H_OPERATOR_MAP에서 IDENTICAL로 처리 (전처리에서 제거)
        # \overset{\frown}{AB} → arch{AB} (호)
        text = re.sub(r'\\overset\s*\{\\frown\}\s*\{([^{}]*)\}', r'arch{\1}', text)
        # \overarc{AB} → arch{AB} (호)
        text = re.sub(r'\\overarc\s*\{([^{}]*)\}', r'arch{\1}', text)
        # \widehat{AB} → arch{AB} (호, 넓은 모자 기호도 호로 사용되는 경우)
        # \langle / \rangle → < / > (단독 사용 시, LEFT/RIGHT 없이)
        text = re.sub(r'\\langle\b', '<', text)
        text = re.sub(r'\\rangle\b', '>', text)
        # \begin{aligned}...\end{aligned} → 내용만 추출
        text = re.sub(r'\\begin\{aligned\}', '', text)
        text = re.sub(r'\\end\{aligned\}', '', text)
        # \longdiv{X} → X (한컴수식에 나눗셈 기호 없음, 내용만 추출)
        # 1 \longdiv { 1 6 } → 1 ) overline {1 6}
        text = re.sub(r'(\S+)\s*\\longdiv\s*\{([^}]*)\}', r'\1 ) overline{\2}', text)
        text = re.sub(r'(\S+)\s*\\longdiv\s+(\S+)', r'\1 ) overline{\2}', text)
        # 연속 공백 정리
        text = re.sub(r'[ \t]+', ' ', text)
        return text.strip()

    def _convert_binom(self, text: str) -> str:
        r"""\binom{A}{B} → LEFT ( pile{A#B} RIGHT )"""
        max_iter = 20
        for _ in range(max_iter):
            idx = text.find(r'\binom')
            if idx == -1:
                break
            pos = idx + len(r'\binom')
            top, pos = _extract_braced_arg(text, pos)
            bot, pos = _extract_braced_arg(text, pos)
            if top is None or bot is None:
                break
            replacement = 'LEFT ( pile{' + top + '#' + bot + '} RIGHT )'
            text = text[:idx] + replacement + text[pos:]
        return text

    def _convert_environments(self, text: str) -> str:
        r"""\begin{cases}...\end{cases} → cases{...}
        \begin{matrix}...\end{matrix} → matrix{...}
        \begin{array}{cl}...\end{array} → cases{...}
        \\ → #  (환경 내부에서)
        """
        env_map = {
            'cases': 'cases',
            'matrix': 'matrix',
            'pmatrix': 'pmatrix',
            'bmatrix': 'bmatrix',
            'vmatrix': 'dmatrix',
            'Vmatrix': 'DMATRIX',
        }

        # \left\{ \begin{array}...\end{array} \right. → cases (조각함수 전체 패턴)
        # \left\{ \begin{cases}...\end{cases} \right. 도 동일
        def _replace_wrapped_env(m):
            inner = m.group(1)
            inner = re.sub(r'\s*\\\\\s*', ' # ', inner)
            inner = inner.replace('&', '\x00')
            return 'cases{' + inner + '}'

        # \left\{ \begin{array}{...}...\end{array} \right.
        text = re.sub(
            r'\\left\s*\\\{\s*\\begin\{array\}\{[^}]*\}(.*?)\\end\{array\}\s*\\right\s*\.',
            _replace_wrapped_env, text, flags=re.DOTALL
        )
        # \left\{ \begin{cases}...\end{cases} \right.
        text = re.sub(
            r'\\left\s*\\\{\s*\\begin\{cases\}(.*?)\\end\{cases\}\s*\\right\s*\.',
            _replace_wrapped_env, text, flags=re.DOTALL
        )
        # \left\{ \begin{aligned}...\end{aligned} \right.
        text = re.sub(
            r'\\left\s*\\\{\s*\\begin\{aligned\}(.*?)\\end\{aligned\}\s*\\right\s*\.',
            _replace_wrapped_env, text, flags=re.DOTALL
        )

        # \begin{array}{...}...\end{array} → cases (단독 array)
        def _replace_array(m):
            inner = m.group(1)
            inner = re.sub(r'\s*\\\\\s*', ' # ', inner)
            # & 보호 (postprocess에서 제거되지 않도록)
            inner = inner.replace('&', '\x00')
            return 'cases{' + inner + '}'

        text = re.sub(
            r'\\begin\{array\}\{[^}]*\}(.*?)\\end\{array\}',
            _replace_array, text, flags=re.DOTALL
        )

        # \begin{env}...\end{env}
        for latex_env, hwp_kw in env_map.items():
            begin_pat = r'\\begin\{' + re.escape(latex_env) + r'\}'
            end_pat = r'\\end\{' + re.escape(latex_env) + r'\}'
            pattern = re.compile(begin_pat + r'(.*?)' + end_pat, re.DOTALL)

            def _make_replacer(kw):
                def replacer(m):
                    inner = m.group(1).strip()
                    # \\\\ (4 = 리터럴 \\) 먼저, 그 다음 \\ (2 = 리터럴 \) 처리
                    inner = re.sub(r'\s*\\\\\s*', ' # ', inner)
                    # & 보호 (postprocess에서 제거되지 않도록)
                    inner = inner.replace('&', '\x00')
                    return kw + '{' + inner + '}'
                return replacer

            text = pattern.sub(_make_replacer(hwp_kw), text)

        # 환경 밖의 \\ (줄바꿈) → 공백
        text = re.sub(r'\s*\\\\\s*', ' ', text)

        return text

    def _convert_frac(self, text: str) -> str:
        r"""재귀적 \frac{a}{b} → {a} over {b} 변환"""
        max_iter = 20
        for _ in range(max_iter):
            idx = text.find(r'\frac')
            if idx == -1:
                break

            # \frac 뒤의 두 개의 {arg} 추출
            pos = idx + len(r'\frac')
            num, pos = _extract_braced_arg(text, pos)
            den, pos = _extract_braced_arg(text, pos)

            if num is None or den is None:
                # 변환 불가능 → 중단 방지
                break

            replacement = '{' + num + '} over {' + den + '}'
            text = text[:idx] + replacement + text[pos:]

        return text

    def _convert_left_right(self, text: str) -> str:
        r"""\left( → LEFT (, \right) → RIGHT )"""
        text = re.sub(r'\\left\s*\(', ' LEFT ( ', text)
        text = re.sub(r'\\left\s*\[', ' LEFT [ ', text)
        text = re.sub(r'\\left\s*\|', ' LEFT | ', text)
        text = re.sub(r'\\left\s*\\{', ' LEFT { ', text)  # \left\{
        text = re.sub(r'\\left\s*\\langle\b', ' LEFT langle ', text)
        text = re.sub(r'\\left\s*<', ' LEFT langle ', text)
        text = re.sub(r'\\left\s*\.', ' LEFT . ', text)

        text = re.sub(r'\\right\s*\)', ' RIGHT )', text)
        text = re.sub(r'\\right\s*\]', ' RIGHT ]', text)
        text = re.sub(r'\\right\s*\|', ' RIGHT |', text)
        text = re.sub(r'\\right\s*\\}', ' RIGHT }', text)  # \right\}
        text = re.sub(r'\\right\s*\\rangle\b', ' RIGHT rangle', text)
        text = re.sub(r'\\right\s*>', ' RIGHT rangle', text)
        text = re.sub(r'\\right\s*\.', ' RIGHT .', text)

        # 단독 \{ → LEFT { , \} → RIGHT } (left/right 없는 집합 중괄호)
        text = re.sub(r'\\{', ' LEFT { ', text)
        text = re.sub(r'\\}', ' RIGHT } ', text)

        return text

    def _convert_sqrt(self, text: str) -> str:
        r"""\sqrt{x} → sqrt{x}, \sqrt[n]{x} → root n of {x}
        단일 문자 인자는 중괄호 제거: sqrt{x} → sqrt x"""
        # \sqrt[n]{x} → root n of {x} (n차 근호, n은 숫자 또는 변수)
        text = re.sub(r'\\sqrt\[([^\]]+)\]\{', r'root \1 of {', text)
        text = re.sub(r'\\sqrt\{', 'sqrt{', text)
        # 단일 문자/숫자 인자 중괄호 제거: sqrt{x} → sqrt x
        text = re.sub(r'sqrt\{([a-zA-Z0-9])\}', r'sqrt \1', text)
        return text

    def _convert_decorations(self, text: str) -> str:
        r"""\hat{x} → hat{x} 등, 단일 문자 인자는 중괄호 제거: hat{x} → hat x"""
        reverse_map = {}
        for hwp_key, latex_cmd in DECORATIONS_H2L.items():
            if hwp_key == hwp_key.lower():  # 소문자만 사용
                reverse_map[latex_cmd] = hwp_key

        for latex_cmd, hwp_key in reverse_map.items():
            # \vec{x} → vec{x} 변환 시 앞 문자와 붙지 않도록 공백 보장
            text = re.sub(
                r'(?<=[a-zA-Z0-9})])' + re.escape(latex_cmd) + r'\{',
                ' ' + hwp_key + '{', text
            )
            text = text.replace(latex_cmd + '{', hwp_key + '{')

        # 단일 문자/숫자 인자 중괄호 제거: hat{x} → hatx, vec{v} → vecv (공백 없이 붙임)
        for dec in ("hat", "bar", "vec", "dot", "tilde", "ddot",
                    "check", "arch", "acute", "grave", "dyad", "under",
                    "overline", "underline"):
            text = re.sub(dec + r'\{([a-zA-Z0-9])\}', dec + r'\1', text)

        return text

    def _convert_operators(self, text: str) -> str:
        """LaTeX 연산자 → HWP 키워드 (L2H 전용 매핑 사용)"""
        # 긴 것부터 매칭 (예: \subseteq 먼저, \in이 \int/\infty 안에 매칭되지 않도록)
        for latex_op, hwp_op in sorted(L2H_OPERATOR_MAP.items(), key=lambda x: -len(x[0])):
            # 앞에 영숫자가 있으면 공백 삽입: x\in → x IN (아닌 xIN)
            text = re.sub(r'(?<=[a-zA-Z0-9})])' + re.escape(latex_op) + r'(?![a-zA-Z])', ' ' + hwp_op, text)
            text = re.sub(re.escape(latex_op) + r'(?![a-zA-Z])', hwp_op, text)
        return text

    def _convert_big_operators(self, text: str) -> str:
        r"""큰 연산자: \sum → sum 등"""
        # LaTeX 이름 → HWP 이름 매핑
        L2H_BIG_OP_MAP = {
            "iint": "dint",
            "iiint": "tint",
            "oiint": "odint",
            "oiiint": "otint",
            "bigcup": "union",
            "bigcap": "inter",
            "bigsqcup": "BIGSQCUP",
            "bigsqcap": "BIGSQCAP",
            "bigoplus": "BIGOPLUS",
            "bigotimes": "BIGOTIMES",
            "bigodot": "BIGODOT",
            "biguplus": "BIGUPLUS",
            "bigvee": "UNDEROVER {LOR }",
            "bigwedge": "UNDEROVER {WEDGE }",
            "coprod": "coprod",
        }
        for op in BIG_OPERATORS:
            hwp_op = L2H_BIG_OP_MAP.get(op, op)
            # 앞에 영숫자가 있으면 공백 삽입
            text = re.sub(r'(?<=[a-zA-Z0-9})])\\' + op + r'(?![a-zA-Z])', ' ' + hwp_op, text)
            text = re.sub(r'\\' + op + r'(?![a-zA-Z])', hwp_op, text)
        return text

    def _convert_math_functions(self, text: str) -> str:
        r"""\sin → sin, \cos → cos 등"""
        for func in MATH_FUNCTIONS:
            # 앞에 영숫자가 있으면 공백 삽입: r\cos → r cos (아닌 rcos)
            text = re.sub(r'(?<=[a-zA-Z0-9})])\\' + func + r'(?=\\[a-zA-Z])', ' ' + func + ' ', text)
            text = re.sub(r'(?<=[a-zA-Z0-9})])\\' + func + r'(?![a-zA-Z])', ' ' + func, text)
            # 앞에 영숫자가 없는 경우
            text = re.sub(r'\\' + func + r'(?=\\[a-zA-Z])', func + ' ', text)
            text = re.sub(r'\\' + func + r'(?![a-zA-Z])', func, text)
        return text

    def _convert_greek(self, text: str) -> str:
        r"""\alpha → alpha, \Gamma → GAMMA 등"""
        # 대문자 그리스 (긴 것부터) — HWP는 전부 대문자 사용
        for letter in sorted(GREEK_UPPER, key=len, reverse=True):
            hwp_letter = letter.upper()
            # 앞에 영숫자가 있으면 공백 삽입: n\Gamma → n GAMMA
            text = re.sub(r'(?<=[a-zA-Z0-9])\\' + letter + r'(?=[a-zA-Z])', ' ' + hwp_letter + ' ', text)
            text = re.sub(r'(?<=[a-zA-Z0-9])\\' + letter + r'(?![a-zA-Z])', ' ' + hwp_letter, text)
            # 앞에 영숫자가 없는 경우
            text = re.sub(r'\\' + letter + r'(?=[a-zA-Z])', hwp_letter + ' ', text)
            text = re.sub(r'\\' + letter + r'(?![a-zA-Z])', hwp_letter, text)
        # 소문자 그리스 (긴 것부터)
        for letter in sorted(GREEK_LOWER, key=len, reverse=True):
            # 앞에 영숫자가 있으면 공백 삽입: n\pi → n pi
            text = re.sub(r'(?<=[a-zA-Z0-9])\\' + letter + r'(?=[a-zA-Z])', ' ' + letter + ' ', text)
            text = re.sub(r'(?<=[a-zA-Z0-9])\\' + letter + r'(?![a-zA-Z])', ' ' + letter, text)
            # 앞에 영숫자가 없는 경우
            text = re.sub(r'\\' + letter + r'(?=[a-zA-Z])', letter + ' ', text)
            text = re.sub(r'\\' + letter + r'(?![a-zA-Z])', letter, text)
        # 그리스문자 앞에 숫자가 붙어있으면 공백 삽입: 2theta → 2 theta, 2pi → 2 pi
        all_greek = sorted(GREEK_LOWER + [g.upper() for g in GREEK_UPPER], key=len, reverse=True)
        for letter in all_greek:
            text = re.sub(r'(?<=[0-9])(' + letter + r')(?![a-zA-Z])', r' \1', text)
        return text

    def _add_sub_sup_spacing(self, text: str) -> str:
        """HWP 스타일 공백 삽입: a_{n} → a _{n}, x^{2} → x ^{2}"""
        # 알파벳/숫자/닫는 괄호 뒤 _{} 앞에 공백
        text = re.sub(r'(?<=[a-zA-Z0-9)\]}])_\{', r' _{', text)
        text = re.sub(r'(?<=[a-zA-Z0-9)\]}])\^\{', r' ^{', text)
        return text

    def _postprocess(self, text: str) -> str:
        """후처리: 잔여 LaTeX 명령 정리, 백틱 스페이싱, 공백 정규화"""
        # 잔여 \, \; \! (thin space 등) 제거
        text = re.sub(r'\\[,;!]', '', text)
        # 잔여 \hspace{...}, \vspace{...} 제거
        text = re.sub(r'\\[hv]space\{[^}]*\}', ' ', text)
        # & (alignment) → 공백 (환경 내부의 보호된 &는 제외)
        text = text.replace('&', ' ')
        # 보호된 & 복원 (환경 내부에서 사용)
        text = text.replace('\x00', '&')
        # HWP 백틱 스페이싱: 한글 텍스트와 수식 기호 사이에 백틱(thin space) 삽입
        # (mod X) → (mod`X)
        text = re.sub(r'\(mod\s+', '(mod`', text)
        # 숫자/문자 바로 뒤 여는 괄호 앞: -1( → -1`(
        text = re.sub(r'(?<=[a-zA-Z0-9])\(', '`(', text)
        # <-, >- 패턴 방지: 한컴수식에서 <- 는 화살표로 해석됨
        # x<-1 → x< -1, x>-1 → x> -1
        text = re.sub(r'<-(?=\d|[a-zA-Z{\\])', '< -', text)
        text = re.sub(r'>-(?=\d|[a-zA-Z{\\])', '> -', text)
        # 연속 공백 정리
        text = re.sub(r'[ \t]+', ' ', text)
        return text.strip()


# ── 편의 함수 ──

_h2l = HwpToLatexRules()
_l2h = LatexToHwpRules()


def hwp_to_latex(text: str) -> str:
    """HWP 수식 → LaTeX 변환 (편의 함수)"""
    return _h2l.convert(text)


def latex_to_hwp(text: str) -> str:
    """LaTeX → HWP 수식 변환 (편의 함수)"""
    return _l2h.convert(text)


def check_rule_confidence(input_text: str, output_text: str, direction: str) -> float:
    """규칙 변환 결과의 신뢰도 점수 (0.0 ~ 1.0)

    다음 기준으로 신뢰도를 판별합니다:
    1. 출력이 비어있으면 0.0
    2. 중괄호 균형 불량이면 감점
    3. 미변환 키워드 잔존이면 감점
    4. 입력 대비 출력 길이 비율이 비정상이면 감점
    """
    if not output_text.strip():
        return 0.0

    score = 1.0

    # 중괄호 균형 체크
    depth = 0
    for ch in output_text:
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        if depth < 0:
            score -= 0.3
            break
    if depth != 0:
        score -= 0.2

    # 미변환 HWP 키워드 잔존 (HWP→LaTeX 방향)
    if direction == "hwp_to_latex":
        remaining_hwp = re.findall(r'\b(OVER|LEFT|RIGHT|SQRT|ROOT|TIMES|LEQ|GEQ|NEQ|CDOTS|LDOTS)\b', output_text)
        if remaining_hwp:
            score -= 0.1 * len(remaining_hwp)

    # 미변환 LaTeX 명령 잔존 (LaTeX→HWP 방향)
    if direction == "latex_to_hwp":
        remaining_latex = re.findall(r'\\(frac|left|right|sqrt)\b', output_text)
        if remaining_latex:
            score -= 0.1 * len(remaining_latex)

    # 길이 비율 체크
    in_len = len(input_text.strip())
    out_len = len(output_text.strip())
    if in_len > 0:
        ratio = out_len / in_len
        if ratio > 5.0 or ratio < 0.1:
            score -= 0.3

    return max(0.0, min(1.0, score))


if __name__ == "__main__":
    # 간단한 테스트
    print("=== HWP → LaTeX ===")
    tests_h2l = [
        ("x ^{2} +2x+1", "x^{2}+2x+1"),
        ("{1} over {2}", r"\frac{1}{2}"),
        ("LEFT ( x RIGHT )", r"\left( x \right)"),
        ("SQRT{x}", r"\sqrt{x}"),
        ("a _{n}", "a_{n}"),
        ("pi < theta", r"\pi < \theta"),
        ("sin x", r"\sin x"),
        ("a+b`", "a+b"),
        ("x ^{2} +2x+1`", "x^{2}+2x+1"),
        ("{a+b} OVER {c+d}", r"\frac{a+b}{c+d}"),
        ("LEFT ( {1} over {2} RIGHT ) ^{k} =2", None),
        ("CDOTS", r"\cdots"),
        ("a GEQ 0", r"a \geq 0"),
        # 새 테스트: 소문자 키워드
        ("a ge 0", r"a \geq 0"),
        ("a le b", r"a \leq b"),
        ("therefore x=1", r"\therefore x=1"),
        # 틸드 처리
        ("a~+~b", "a + b"),
        # INF 키워드
        ("x RIGHTARROW INF", None),
        # SEARROW
        ("SEARROW", r"\searrow"),
    ]

    h2l = HwpToLatexRules()
    for hwp, expected in tests_h2l:
        result = h2l.convert(hwp)
        status = ""
        if expected:
            norm_r = re.sub(r'\s+', '', result)
            norm_e = re.sub(r'\s+', '', expected)
            status = " OK" if norm_r == norm_e else f" FAIL (expected: {expected})"
        print(f"  {hwp!r:40s} → {result!r}{status}")

    print("\n=== LaTeX → HWP ===")
    tests_l2h = [
        (r"\frac{1}{2}", "{1} over {2}"),
        (r"\left(\right)", "LEFT ( RIGHT )"),
        (r"\sqrt{x}", "sqrt x"),
        (r"\pi", "pi"),
        (r"\sin x", "sin x"),
        (r"a_{n}", "a _{n}"),
        (r"\cdots", "CDOTS"),
        # L2H 소문자 출력 테스트
        (r"a \geq 0", "a ge 0"),
        (r"a \leq b", "a le b"),
        (r"\therefore x=1", "therefore x=1"),
        # \quad 처리
        (r"a \quad b", "a b"),
        # \text 처리
        (r"\text{cm}", "cm"),
        # \prime 처리
        (r"f\prime", "f'"),
    ]

    l2h = LatexToHwpRules()
    for latex, expected in tests_l2h:
        result = l2h.convert(latex)
        status = ""
        if expected:
            norm_r = re.sub(r'\s+', '', result)
            norm_e = re.sub(r'\s+', '', expected)
            status = " OK" if norm_r == norm_e else f" FAIL (expected: {expected})"
        print(f"  {latex!r:40s} → {result!r}{status}")
