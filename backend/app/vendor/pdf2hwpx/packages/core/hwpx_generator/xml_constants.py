"""
HWPX XML 상수 및 유틸리티

builder.py에서 사용하는 네임스페이스, 기본값, ID 생성 함수.
"""

import random

# HWPX XML 네임스페이스
NAMESPACES = {
    'ha': 'http://www.hancom.co.kr/hwpml/2011/app',
    'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
    'hp10': 'http://www.hancom.co.kr/hwpml/2016/paragraph',
    'hs': 'http://www.hancom.co.kr/hwpml/2011/section',
    'hc': 'http://www.hancom.co.kr/hwpml/2011/core',
    'hh': 'http://www.hancom.co.kr/hwpml/2011/head',
    'hhs': 'http://www.hancom.co.kr/hwpml/2011/history',
    'hm': 'http://www.hancom.co.kr/hwpml/2011/master-page',
    'hpf': 'http://www.hancom.co.kr/schema/2011/hpf',
    'dc': 'http://purl.org/dc/elements/1.1/',
    'opf': 'http://www.idpf.org/2007/opf/',
    'ooxmlchart': 'http://www.hancom.co.kr/hwpml/2016/ooxmlchart',
    'hwpunitchar': 'http://www.hancom.co.kr/hwpml/2016/HwpUnitChar',
    'epub': 'http://www.idpf.org/2007/ops',
    'config': 'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
}

# 기본 줄 높이 (HWPUNIT)
DEFAULT_LINE_HEIGHT = 1000
DEFAULT_BASELINE = 850
DEFAULT_SPACING = 600
# 표 기본 셀 높이 (HWPUNIT)
DEFAULT_CELL_HEIGHT = 1600
DEFAULT_CELL_MARGIN = 141
# 표 기본 borderFillIDRef (실선 테두리 = id 4)
DEFAULT_TABLE_BORDER_FILL = "4"
DEFAULT_CELL_BORDER_FILL = "4"
# 수식 포함 문단의 줄 높이
EQ_LINE_HEIGHT = 1400
EQ_BASELINE = 1190
EQ_SPACING = 840
# 페이지 본문 너비 (기본: A4 - 좌우 여백)
DEFAULT_HORZ_SIZE = 48190


def _gen_id():
    """HWPX 고유 ID 생성 (양의 32비트 정수)"""
    return str(random.randint(1000000000, 2147483647))


# ── 페이지 레이아웃 템플릿 프리셋 ──
# 1mm ≈ 283.46 HWPUNIT
# A4 = 210×297mm = 59528×84186, B5 = 176×250mm = 49896×70866

TEMPLATES = {
    "default": {
        "label": "기본",
        "description": "기본 A4 2단",
        "page_width": 59528,
        "page_height": 84186,
        "margin_left": 5669,   # 20mm
        "margin_right": 5669,
        "margin_top": 4251,    # 15mm
        "margin_bottom": 2834, # 10mm
        "col_gap": 1134,       # 4mm
        "landscape": "WIDELY",
    },
    "csat_exam": {
        "label": "수능/모의고사",
        "description": "수능·모의고사 스타일 — 여백 최소화, 콘텐츠 최대",
        "page_width": 59528,
        "page_height": 84186,
        "margin_left": 2835,   # 10mm
        "margin_right": 2835,
        "margin_top": 3402,    # 12mm
        "margin_bottom": 2835,
        "col_gap": 1417,       # 5mm
        "landscape": "WIDELY",
    },
    "school_exam": {
        "label": "학교 시험지",
        "description": "학교 내신 시험지 — 상단 여백 넓게 (학교명·과목·학년 기입란)",
        "page_width": 59528,
        "page_height": 84186,
        "margin_left": 4252,   # 15mm
        "margin_right": 4252,
        "margin_top": 8504,    # 30mm (헤더 기입란)
        "margin_bottom": 4252,
        "col_gap": 2268,       # 8mm
        "landscape": "WIDELY",
    },
    "b5_workbook": {
        "label": "B5 문제집",
        "description": "B5 판형 문제집 스타일 — 컴팩트",
        "page_width": 49896,
        "page_height": 70866,
        "margin_left": 3969,   # 14mm
        "margin_right": 3969,
        "margin_top": 3969,
        "margin_bottom": 3402, # 12mm
        "col_gap": 1984,       # 7mm
        "landscape": "WIDELY",
    },
    "mini_test": {
        "label": "미니 테스트",
        "description": "A4 가로 — 수업 중 쪽지시험용",
        "page_width": 84186,
        "page_height": 59528,
        "margin_left": 4252,
        "margin_right": 4252,
        "margin_top": 4252,
        "margin_bottom": 3402,
        "col_gap": 2268,
        "landscape": "NARROWLY",
    },
    "worksheet": {
        "label": "A4 학습지",
        "description": "여유로운 여백 — 풀이 공간 확보용 학습지",
        "page_width": 59528,
        "page_height": 84186,
        "margin_left": 5669,   # 20mm
        "margin_right": 5669,
        "margin_top": 7086,    # 25mm
        "margin_bottom": 5669,
        "col_gap": 2835,       # 10mm
        "landscape": "WIDELY",
    },
    "textbook_a4": {
        "label": "A4 교재 (출판용)",
        "description": "출판 교재 스타일 A4 — 안쪽 여백 넓게, 바깥 여백 좁게 (제본 고려)",
        "page_width": 59528,
        "page_height": 84186,
        "margin_left": 7086,   # 25mm (제본 안쪽)
        "margin_right": 4252,  # 15mm (바깥)
        "margin_top": 5669,    # 20mm
        "margin_bottom": 5669,
        "col_gap": 1984,       # 7mm
        "landscape": "WIDELY",
    },
    "textbook_b5": {
        "label": "B5 교재 (출판용)",
        "description": "출판 교재 스타일 B5 — 국배판, 일반 참고서·문제집 크기",
        "page_width": 49896,
        "page_height": 70866,
        "margin_left": 5669,   # 20mm (제본 안쪽)
        "margin_right": 3685,  # 13mm (바깥)
        "margin_top": 4535,    # 16mm
        "margin_bottom": 4535,
        "col_gap": 1701,       # 6mm
        "landscape": "WIDELY",
    },
    "textbook_46": {
        "label": "46배판 교재",
        "description": "46배판(188×257mm) — EBS·수능특강 등 교재 표준 판형",
        "page_width": 53291,   # 188mm
        "page_height": 72851,  # 257mm
        "margin_left": 5669,   # 20mm
        "margin_right": 3969,  # 14mm
        "margin_top": 4535,    # 16mm
        "margin_bottom": 4535,
        "col_gap": 1701,       # 6mm
        "landscape": "WIDELY",
    },
}
