#!/usr/bin/env python3
"""
Mathpix Markdown (.mmd) → DocumentIR 파서
"""

import re
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'core', 'ir'))
from schema import (
    DocumentIR, DocumentMetadata, Section,
    ParagraphBlock, HeadingBlock, EquationBlock, TableBlock, ImageBlock,
    TextRun, InlineEquation, TableRow,
)


def parse_mmd(text: str, source: str = "") -> DocumentIR:
    """Mathpix Markdown 텍스트 → DocumentIR 변환"""
    doc = DocumentIR(
        metadata=DocumentMetadata(title=source, source=source),
    )
    section = doc.sections[0]

    lines = text.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i]

        if not line.strip():
            i += 1
            continue

        # 블록 수식: $$ ... $$
        if line.strip().startswith('$$'):
            latex_lines = []
            stripped = line.strip()

            if stripped == '$$':
                # $$ 만 있는 줄 — 다음 $$ 까지 수집
                i += 1
                while i < len(lines) and not lines[i].strip().endswith('$$'):
                    latex_lines.append(lines[i])
                    i += 1
                if i < len(lines):
                    # 닫는 줄에서 $$ 제거
                    closing = lines[i].strip()
                    if closing != '$$':
                        latex_lines.append(closing[:-2])
                    i += 1
            elif stripped.endswith('$$') and len(stripped) > 4:
                # 한 줄짜리: $$...$$
                latex_lines.append(stripped[2:-2])
                i += 1
            else:
                # $$ 로 시작하지만 같은 줄에 안 닫힘 — 다음 $$ 까지 수집
                latex_lines.append(stripped[2:])
                i += 1
                while i < len(lines):
                    ln = lines[i].strip()
                    if ln.endswith('$$'):
                        remainder = ln[:-2].strip()
                        if remainder:
                            latex_lines.append(remainder)
                        i += 1
                        break
                    latex_lines.append(lines[i])
                    i += 1

            latex = '\n'.join(latex_lines).strip()
            # 빈 줄 제거 (KaTeX가 빈 줄에서 파싱을 끊음)
            latex = re.sub(r'\n\s*\n', '\n', latex)
            if latex:
                section.blocks.append(EquationBlock(latex=latex))
            continue

        # LaTeX tabular → 표 블록 (수식이 아닌 HWPX 표로 변환)
        tabular_match = re.search(r'\\begin\{tabular\}', line.strip())
        if tabular_match:
            tab_lines = [line.strip()]
            i += 1
            if not re.search(r'\\end\{tabular\}', line):
                while i < len(lines):
                    tab_lines.append(lines[i])
                    if re.search(r'\\end\{tabular\}', lines[i]):
                        i += 1
                        break
                    i += 1
            tabular_text = '\n'.join(tab_lines).strip()
            # $$ 감싸져 있으면 제거
            if tabular_text.startswith('$$'):
                tabular_text = tabular_text[2:]
            if tabular_text.endswith('$$'):
                tabular_text = tabular_text[:-2]
            tabular_text = tabular_text.strip()
            table_block = _parse_tabular_to_table(tabular_text)
            if table_block:
                section.blocks.append(table_block)
            continue

        # bare LaTeX 환경: \begin{aligned}, \begin{array}, \begin{cases} 등
        # Mathpix가 $$ 없이 출력하는 경우 처리
        # 단, $...\begin{array}...\end{array}...$ 처럼 $로 감싸져 있으면 인라인 수식이므로 스킵
        _ENV_NAMES = r'aligned|align|array|cases|gather|equation|pmatrix|bmatrix|vmatrix|matrix|split'
        _has_dollar = re.search(r'(?<!\$)\$(?!\$)', line.strip())
        bare_env_match = re.search(
            rf'\\begin\{{({_ENV_NAMES})\*?\}}',
            line.strip()
        )
        if bare_env_match and not _has_dollar:
            env_name = bare_env_match.group(1)
            latex_lines = [line.strip()]
            i += 1
            # \end{env} 찾을 때까지 수집 (첫 줄에 이미 있을 수도 있음)
            if not re.search(rf'\\end\{{{env_name}\*?\}}', line):
                while i < len(lines):
                    latex_lines.append(lines[i])
                    if re.search(rf'\\end\{{{env_name}\*?\}}', lines[i]):
                        i += 1
                        break
                    i += 1
            latex = '\n'.join(latex_lines).strip()
            # Mathpix가 닫는 $$ 를 \end{...} 뒤에 붙이는 경우 제거
            if latex.endswith('$$'):
                latex = latex[:-2].strip()
            # 앞에 $$ 가 붙어있는 경우도 제거
            if latex.startswith('$$'):
                latex = latex[2:].strip()
            # 빈 줄 제거 (KaTeX가 빈 줄에서 파싱을 끊음)
            latex = re.sub(r'\n\s*\n', '\n', latex)
            section.blocks.append(EquationBlock(latex=latex))
            continue

        # 제목 (마크다운 # 또는 LaTeX \section*)
        section_match = re.match(r'^\\section\*?\{(.+)\}\s*$', line)
        if section_match:
            content = section_match.group(1)
            runs = _parse_inline(content)
            section.blocks.append(HeadingBlock(level=1, runs=runs))
            i += 1
            continue

        heading_match = re.match(r'^(#{1,3})\s+(.+)$', line)
        if heading_match:
            level = len(heading_match.group(1))
            content = heading_match.group(2)
            runs = _parse_inline(content)
            section.blocks.append(HeadingBlock(level=level, runs=runs))
            i += 1
            continue

        # 표
        if line.strip().startswith('|') and '|' in line.strip()[1:]:
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            table_block = _parse_table(table_lines)
            if table_block:
                section.blocks.append(table_block)
            continue

        # LaTeX figure 환경: \begin{figure}...\end{figure}
        # Mathpix가 OCR 실패 시 이미지를 figure로 감싸서 반환 → URL 추출하여 이미지 블록으로
        if re.match(r'\\begin\{figure\}', line.strip()):
            fig_lines = [line.strip()]
            i += 1
            while i < len(lines):
                fig_lines.append(lines[i])
                if re.search(r'\\end\{figure\}', lines[i]):
                    i += 1
                    break
                i += 1
            fig_text = '\n'.join(fig_lines)
            # \includegraphics 에서 URL 추출
            url_match = re.search(
                r'\\includegraphics(?:\[[^\]]*\])?\{(https?://[^}]+)\}', fig_text
            )
            if url_match:
                section.blocks.append(ImageBlock(src=url_match.group(1)))
            else:
                # URL 없으면 텍스트로 폴백
                section.blocks.append(ParagraphBlock(runs=[TextRun(content='[figure]')]))
            continue

        # 이미지: Markdown 표준 ![alt](url) 형식
        img_match = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', line.strip())
        if img_match:
            src = img_match.group(2)
            section.blocks.append(ImageBlock(src=src))
            i += 1
            continue

        # 이미지: Mathpix 표기법 [이미지: https://cdn.mathpix.com/...]
        mathpix_img = re.match(
            r'\[이미지:\s*(https?://[^\]]+)\]', line.strip()
        )
        if mathpix_img:
            src = mathpix_img.group(1).strip()
            section.blocks.append(ImageBlock(src=src))
            i += 1
            continue

        # 이미지: Mathpix 영문 표기 ![](https://cdn.mathpix.com/...) 또는 인라인
        mathpix_img2 = re.search(
            r'!\[\]\((https://cdn\.mathpix\.com/[^)]+)\)', line.strip()
        )
        if mathpix_img2:
            src = mathpix_img2.group(1).strip()
            section.blocks.append(ImageBlock(src=src))
            i += 1
            continue

        # <보기> / <조건> / [보기] / [조건] 박스: 선지(①) 전까지를 1행1열 표로 감싸기
        bogi_match = re.match(
            r'^[<\[]\s*보\s*기\s*[>\]]|^[<\[]\s*조\s*건\s*[>\]]',
            line.strip()
        )
        if bogi_match:
            box_lines = [line.strip()]
            i += 1
            while i < len(lines):
                ln = lines[i].strip()
                if not ln:
                    i += 1
                    continue
                # ① ~ ⑮ 선지 시작이면 박스 끝
                if re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]', ln):
                    break
                # 다음 문항 시작이면 박스 끝
                if re.match(r'^\d{1,2}[\.\)]\s', ln):
                    break
                box_lines.append(ln)
                i += 1
            # N행1열 표로 감싸기 (줄마다 별도 행 → 수식 렌더링 가능)
            rows = []
            for bl in box_lines:
                row_runs = _parse_inline(bl)
                if row_runs:
                    rows.append(TableRow(cells=[row_runs]))
            if rows:
                section.blocks.append(TableBlock(rows=rows, is_box=True))
            continue

        # 일반 텍스트
        runs = _parse_inline(line)
        section.blocks.append(ParagraphBlock(runs=runs))
        i += 1

    return doc


def _parse_inline(text: str) -> list:
    """인라인 텍스트에서 $...$ 수식과 bare LaTeX 환경을 분리"""
    runs = []

    # 1단계: $...$ 로 분리
    parts = re.split(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)', text)

    for idx, part in enumerate(parts):
        if idx % 2 == 0:
            if part:
                # 2단계: 텍스트 부분에서 bare LaTeX 환경 감지
                sub_runs = _split_bare_latex(part)
                runs.extend(sub_runs)
        else:
            if part.strip():
                runs.append(InlineEquation(latex=part.strip()))

    if not runs and text:
        runs.append(TextRun(content=text))

    return runs


# bare LaTeX 환경 패턴
_BARE_LATEX_RE = re.compile(
    r'(\\begin\{(?:aligned|align|array|cases|gather|equation|pmatrix|bmatrix|vmatrix|matrix|split)\*?\}'
    r'.*?'
    r'\\end\{(?:aligned|align|array|cases|gather|equation|pmatrix|bmatrix|vmatrix|matrix|split)\*?\})',
    re.DOTALL
)


def _split_bare_latex(text: str) -> list:
    r"""텍스트에서 bare LaTeX 환경(\begin{...}...\end{...})을 수식으로 분리"""
    result = []
    last_end = 0

    for m in _BARE_LATEX_RE.finditer(text):
        # 매치 앞 텍스트
        before = text[last_end:m.start()]
        if before.strip():
            result.append(TextRun(content=before))
        # LaTeX 환경 → 수식
        result.append(InlineEquation(latex=m.group(1).strip()))
        last_end = m.end()

    # 남은 텍스트
    remainder = text[last_end:]
    if remainder.strip():
        result.append(TextRun(content=remainder))

    if not result and text:
        result.append(TextRun(content=text))

    return result


def _parse_tabular_to_table(tabular_text: str):
    r"""LaTeX \begin{tabular}...\end{tabular} → TableBlock 변환.

    해설의 부호 판별표, 증감표 등을 HWPX 표로 변환.
    셀 내 $...$는 인라인 수식으로 처리.
    """
    # \begin{tabular}{...} 와 \end{tabular} 제거
    body = re.sub(r'\\begin\{tabular\}\{[^}]*\}', '', tabular_text)
    body = re.sub(r'\\end\{tabular\}', '', body)
    body = body.strip()

    rows = []
    raw_rows = re.split(r'\\\\', body)
    for raw_row in raw_rows:
        raw_row = raw_row.strip()
        raw_row = raw_row.replace(r'\hline', '').strip()
        if not raw_row:
            continue

        cells = []
        for cell_text in raw_row.split('&'):
            cell_text = cell_text.strip()
            cell_runs = _parse_inline(cell_text)
            if not cell_runs:
                cell_runs = [TextRun(content=cell_text)]
            cells.append(cell_runs)
        rows.append(TableRow(cells=cells))

    if not rows:
        return None

    return TableBlock(rows=rows)


def _parse_table(lines: list[str]):
    """Markdown 표 파싱"""
    if len(lines) < 2:
        return None

    rows = []
    for line in lines:
        if re.match(r'^\|[\s\-:]+\|', line):
            continue

        cells = []
        parts = line.strip().strip('|').split('|')
        for part in parts:
            cell_runs = _parse_inline(part.strip())
            cells.append(cell_runs)
        rows.append(TableRow(cells=cells))

    if not rows:
        return None

    return TableBlock(rows=rows)


def parse_mmd_file(mmd_path: str) -> DocumentIR:
    """파일에서 .mmd를 읽어 DocumentIR로 변환"""
    with open(mmd_path, 'r', encoding='utf-8') as f:
        text = f.read()
    return parse_mmd(text, source=os.path.basename(mmd_path))


# ── 모의고사 전처리 ──

# 문항 번호 패턴: "1.", "2.", ... "30." 또는 "(1)", "(2)" 등
_Q_NUM_RE = re.compile(r'^\*{0,2}(\d{1,2})\.\*{0,2}\s*(?=\S)')


def reorder_exam_questions(mmd_text: str) -> str:
    """모의고사 MMD에서 문항 번호 순서대로 정렬.

    2단 레이아웃 때문에 Mathpix가 문항 순서를 뒤바꾸는 경우가 많음.
    페이지 구분자(---)는 유지하면서, 각 페이지 내에서 문항을 번호순으로 정렬.
    """
    pages = mmd_text.split('\n\n---\n\n')
    sorted_pages = []

    for page in pages:
        lines = page.split('\n')
        # 문항 블록으로 분리
        blocks = []  # [(question_num or -1, block_lines)]
        current_block = []
        current_num = -1

        for line in lines:
            q_match = _Q_NUM_RE.match(line.strip())
            if q_match:
                # 새 문항 시작 → 이전 블록 저장
                if current_block:
                    blocks.append((current_num, '\n'.join(current_block)))
                current_num = int(q_match.group(1))
                current_block = [line]
            else:
                current_block.append(line)

        # 마지막 블록
        if current_block:
            blocks.append((current_num, '\n'.join(current_block)))

        # 문항이 2개 이상이면 정렬
        if len([b for b in blocks if b[0] > 0]) >= 2:
            # 비문항 블록(���더 등)은 앞에 유지, 문항 블록만 정렬
            header_blocks = []
            question_blocks = []
            for num, text in blocks:
                if num <= 0:
                    if not question_blocks:
                        header_blocks.append(text)
                    else:
                        # 문항 뒤의 비문항 블록은 직전 문항에 붙이기
                        question_blocks[-1] = (question_blocks[-1][0],
                                                question_blocks[-1][1] + '\n' + text)
                else:
                    question_blocks.append((num, text))

            question_blocks.sort(key=lambda x: x[0])
            sorted_page = '\n'.join(header_blocks)
            if header_blocks and question_blocks:
                sorted_page += '\n'
            sorted_page += '\n'.join(text for _, text in question_blocks)
            sorted_pages.append(sorted_page)
        else:
            sorted_pages.append(page)

    return '\n\n---\n\n'.join(sorted_pages)
