#!/usr/bin/env python3
"""
IR → HWPX 통합 파이프라인

DocumentIR을 받아서:
1. LaTeX 수식 → 한컴 수식 변환
2. section0.xml 빌드
3. HWPX 패키징
"""

import sys
import os
import re
import logging

logger = logging.getLogger(__name__)

# 경로 설정
_CORE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_CORE_DIR, "equation_converter"))
sys.path.insert(0, os.path.join(_CORE_DIR, "hwpx_generator"))
sys.path.insert(0, os.path.join(_CORE_DIR, "ir"))

from schema import (
    DocumentIR, Section,
    ParagraphBlock, HeadingBlock, EquationBlock, TableBlock, ImageBlock,
    TextRun, InlineEquation, TableRow,
)
from rules import LatexToHwpRules
from builder import SectionBuilder, DEFAULT_HORZ_SIZE, TEMPLATES
from packager import package_hwpx

_l2h = LatexToHwpRules()


_Q_NUM_RE = re.compile(r'^\*{0,2}(\d{1,2})[\.\)]\*{0,2}\s*')
_SOLUTION_HEADING_RE = re.compile(r'해설|정답|풀이|답안')


def _get_heading_text(block) -> str:
    """HeadingBlock에서 텍스트 추출."""
    return ''.join(r.content for r in block.runs if isinstance(r, TextRun))


def ir_to_hwpx(doc: DocumentIR, output_path: str,
               template_dir: str = None,
               columns: int = 1,
               fix_equations: bool = False,
               template: str = "default") -> str:
    """DocumentIR → HWPX 파일 변환

    Args:
        columns: 다단 수 (1=단일, 2=2단). 2단일 때 문항마다 단 나누기 삽입.
        fix_equations: True이면 HWP COM으로 수식 크기 재계산 (Windows+한/글 필요)
        template: 페이지 레이아웃 템플릿 이름 (xml_constants.TEMPLATES 키)
    """
    tmpl = TEMPLATES.get(template, TEMPLATES["default"])
    builder = SectionBuilder(
        page_width=tmpl["page_width"],
        page_height=tmpl["page_height"],
        margin_left=tmpl["margin_left"],
        margin_right=tmpl["margin_right"],
        margin_top=tmpl["margin_top"],
        margin_bottom=tmpl["margin_bottom"],
        col_gap=tmpl["col_gap"],
        landscape=tmpl["landscape"],
        columns=columns,
    )
    images = {}

    question_count = 0  # 현재 페이지의 문항 수 (2단에서 단 나누기 판단용)
    in_solution = False  # 해설 영역 진입 여부

    for section in doc.sections:
        for block in section.blocks:
            btype = getattr(block, 'type', '')

            # 해설/정답 영역 감지 → 1단으로 섹션 전환
            if btype == 'heading' and columns == 2 and not in_solution:
                heading_text = _get_heading_text(block)
                if _SOLUTION_HEADING_RE.search(heading_text):
                    in_solution = True
                    builder.add_section_change(columns=1)

            # 2단 모드 & 문제 영역: 문항번호 감지 → 단 나누기 / 페이지 나누기
            if columns == 2 and not in_solution and btype == 'paragraph' and block.runs:
                first_text = ''
                for r in block.runs:
                    if isinstance(r, TextRun):
                        first_text = r.content
                        break
                if _Q_NUM_RE.match(first_text.strip()):
                    if question_count > 0:
                        # 매 문항마다 단 나누기 → 한/글이 자동으로 다음 단/페이지 처리
                        builder.add_column_break()
                    question_count += 1

            if btype == 'paragraph':
                _add_paragraph(builder, block)
            elif btype == 'heading':
                _add_heading(builder, block)
            elif btype == 'equation_block':
                _add_block_equation(builder, block)
            elif btype == 'table':
                _add_table(builder, block)
            elif btype == 'image':
                _add_image(builder, block, images)

    section_xml = builder.build()

    result = package_hwpx(
        section_xml=section_xml,
        output_path=output_path,
        template_dir=template_dir,
        title=doc.metadata.title or "문서",
        images=images if images else None,
    )

    if fix_equations:
        try:
            from .hwp_postprocess import postprocess_hwpx
            result = postprocess_hwpx(result)
        except ImportError:
            logger.warning("hwp_postprocess 모듈 없음 — 수식 후처리 건너뜀")
        except Exception as e:
            logger.warning(f"수식 후처리 실패: {e}")

    return result


def _convert_runs(runs) -> list[dict]:
    """IR InlineRun 리스트 → builder용 run dicts"""
    result = []
    for run in runs:
        if isinstance(run, TextRun):
            result.append({"type": "text", "content": run.content})
        elif isinstance(run, InlineEquation):
            hwp_script = _l2h.convert(run.latex)
            result.append({"type": "equation", "script": hwp_script, "inline": True})
    return result


def _add_paragraph(builder: SectionBuilder, block: ParagraphBlock):
    """문단 블록 추가"""
    has_equation = any(isinstance(r, InlineEquation) for r in block.runs)

    if has_equation:
        runs = _convert_runs(block.runs)
        builder.add_rich_paragraph(runs)
    else:
        text = ''.join(r.content for r in block.runs if isinstance(r, TextRun))
        builder.add_paragraph(text)


def _add_heading(builder: SectionBuilder, block: HeadingBlock):
    """제목 블록 추가"""
    has_equation = any(isinstance(r, InlineEquation) for r in block.runs)

    if has_equation:
        runs = _convert_runs(block.runs)
        builder.add_rich_paragraph(runs, para_pr_id=str(block.level),
                                   style_id=str(block.level))
    else:
        text = ''.join(r.content for r in block.runs if isinstance(r, TextRun))
        builder.add_heading(text, level=block.level)


def _add_block_equation(builder: SectionBuilder, block: EquationBlock):
    """블록 수식 추가 (별도 줄)"""
    hwp_script = _l2h.convert(block.latex)
    builder.add_rich_paragraph([
        {"type": "equation", "script": hwp_script, "inline": False},
    ])


def _add_table(builder: SectionBuilder, block: TableBlock):
    """표 추가 — <hp:tbl> XML로 생성"""
    # <보기>/<조건> 박스: N행1열, 다단 폭에 맞춤, 수식 렌더링 지원
    if block.is_box:
        col_widths = [builder._horz_size]
        table_rows = []
        for row in block.rows:
            for cell in row.cells:
                # rich runs 리스트로 변환 (텍스트+수식 혼합 지원)
                runs = []
                for run in cell:
                    if isinstance(run, TextRun):
                        runs.append({"type": "text", "content": run.content})
                    elif isinstance(run, InlineEquation):
                        hwp_script = _l2h.convert(run.latex)
                        runs.append({"type": "equation", "script": hwp_script})
                table_rows.append([runs])  # 1열에 rich runs 리스트
        if table_rows:
            builder.add_table(table_rows, col_widths)
        return

    num_cols = max((len(row.cells) for row in block.rows), default=0)
    if num_cols == 0:
        return

    # 열 너비 계산: 균등 배분 (페이지 본문 영역 기준)
    if block.col_widths:
        col_widths = block.col_widths
    else:
        col_width = DEFAULT_HORZ_SIZE // num_cols
        col_widths = [col_width] * num_cols

    # 셀 데이터 변환: IR runs → builder 형식 (str 또는 dict)
    table_rows = []
    for row in block.rows:
        table_row = []
        for cell in row.cells:
            if len(cell) == 1 and isinstance(cell[0], InlineEquation):
                # 단일 수식 셀
                hwp_script = _l2h.convert(cell[0].latex)
                table_row.append({"type": "equation", "script": hwp_script})
            else:
                # 텍스트 (수식은 [latex] 표기)
                parts = []
                for run in cell:
                    if isinstance(run, TextRun):
                        parts.append(run.content)
                    elif isinstance(run, InlineEquation):
                        parts.append(run.latex)
                table_row.append("".join(parts))
        # 열 수 맞추기
        while len(table_row) < num_cols:
            table_row.append("")
        table_rows.append(table_row)

    builder.add_table(table_rows, col_widths)


def _add_image(builder: SectionBuilder, block: ImageBlock, images: dict):
    """이미지 추가 — URL에서 다운로드하여 HWPX에 임베딩"""
    src = block.src
    if not src:
        return

    # 이미 다운로드된 이미지인 경우 (bin_id 설정됨)
    if block.bin_id and block.bin_id in images:
        _embed_image(builder, block.bin_id, images[block.bin_id])
        return

    # data URI (base64 인코딩 이미지)
    if src.startswith("data:"):
        try:
            import base64 as b64mod
            # data:image/png;base64,xxxxx
            header, b64data = src.split(",", 1)
            img_data = b64mod.b64decode(b64data)
            mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
            ext = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif'}.get(mime, 'png')
            idx = len(images) + 1
            bin_id = f"image{idx}.{ext}"
            images[bin_id] = img_data
            _embed_image(builder, bin_id, img_data)
            return
        except Exception as e:
            logger.warning(f"data URI 파싱 실패: {e}")
            return

    # URL이면 다운로드
    if src.startswith("http://") or src.startswith("https://"):
        try:
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                             '..', 'extractor'))
            from mathpix_client import download_image, get_image_dimensions

            img_data, filename = download_image(src)

            # 중복 방지: 고유 파일명
            idx = len(images) + 1
            ext = filename.rsplit('.', 1)[-1] if '.' in filename else 'png'
            bin_id = f"image{idx}.{ext}"

            images[bin_id] = img_data
            _embed_image(builder, bin_id, img_data)
            logger.info(f"이미지 다운로드 완료: {src} → {bin_id}")

        except Exception as e:
            logger.warning(f"이미지 다운로드 실패: {src} — {e}")
            builder.add_paragraph(f"[이미지 로드 실패: {src}]")
    else:
        # 로컬 파일
        if os.path.exists(src):
            try:
                with open(src, 'rb') as f:
                    img_data = f.read()
                idx = len(images) + 1
                ext = src.rsplit('.', 1)[-1] if '.' in src else 'png'
                bin_id = f"image{idx}.{ext}"
                images[bin_id] = img_data
                _embed_image(builder, bin_id, img_data)
            except Exception as e:
                builder.add_paragraph(f"[이미지 로드 실패: {src}]")
        else:
            builder.add_paragraph(f"[이미지: {src}]")


def _embed_image(builder: SectionBuilder, bin_id: str, img_data: bytes):
    """이미지 데이터를 builder에 삽입 (크기 계산 포함)"""
    try:
        from mathpix_client import get_image_dimensions
        w_px, h_px = get_image_dimensions(img_data)
    except Exception:
        w_px, h_px = 400, 300  # fallback

    # 픽셀 → HWPUNIT 변환 (1 inch = 7200 HWPUNIT, 96 DPI 기준)
    w_hu = int(w_px * 7200 / 96)
    h_hu = int(h_px * 7200 / 96)

    builder.add_image(bin_id, w_hu, h_hu)


def _parse_inline(text: str) -> list:
    """텍스트에서 $...$ 인라인 수식을 파싱하여 runs 리스트 반환"""
    runs = []
    parts = re.split(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)', text)
    for idx, part in enumerate(parts):
        if idx % 2 == 0:
            if part:
                runs.append(TextRun(content=part))
        else:
            if part.strip():
                runs.append(InlineEquation(latex=part.strip()))
    return runs


def _parse_tabular(tabular_text: str) -> TableBlock:
    r"""LaTeX \begin{tabular}...\end{tabular} → TableBlock 변환

    지원: & 열 구분, \\ 행 구분, \hline 무시, $...$ 셀 내 수식
    """
    # \begin{tabular}{...} 와 \end{tabular} 제거
    body = re.sub(r'\\begin\{tabular\}\{[^}]*\}', '', tabular_text)
    body = re.sub(r'\\end\{tabular\}', '', body)
    body = body.strip()

    rows = []
    # \\ 또는 줄바꿈으로 행 분리
    raw_rows = re.split(r'\\\\', body)
    for raw_row in raw_rows:
        raw_row = raw_row.strip()
        # \hline 제거
        raw_row = raw_row.replace(r'\hline', '').strip()
        if not raw_row:
            continue

        # & 로 셀 분리
        cells = []
        for cell_text in raw_row.split('&'):
            cell_text = cell_text.strip()
            cell_runs = _parse_inline(cell_text)
            if not cell_runs:
                cell_runs = [TextRun(content=cell_text)]
            cells.append(cell_runs)
        rows.append(TableRow(cells=cells))

    return TableBlock(rows=rows)


def latex_text_to_hwpx(text: str, output_path: str,
                       template_dir: str = None) -> str:
    r"""LaTeX 혼합 텍스트 → HWPX 간편 변환

    $...$ 또는 $$...$$ 로 감싼 수식을 자동 파싱하여 HWPX로 변환.
    \begin{tabular}...\end{tabular} 표도 자동 변환.
    """
    doc = DocumentIR()
    section = doc.sections[0]

    # tabular 환경을 먼저 추출하여 플레이스홀더로 치환
    tabular_blocks = {}
    def _replace_tabular(m):
        key = f'__TABULAR_{len(tabular_blocks)}__'
        tabular_blocks[key] = _parse_tabular(m.group(0))
        return key

    text = re.sub(
        r'\\begin\{tabular\}\{[^}]*\}.*?\\end\{tabular\}',
        _replace_tabular, text, flags=re.DOTALL
    )

    for line in text.split('\n'):
        line = line.strip()
        if not line:
            section.blocks.append(ParagraphBlock(runs=[TextRun(content="")]))
            continue

        # tabular 플레이스홀더
        if line in tabular_blocks:
            section.blocks.append(tabular_blocks[line])
            continue

        # $$ ... $$ (블록 수식)
        if line.startswith('$$') and line.endswith('$$') and len(line) > 4:
            latex = line[2:-2].strip()
            section.blocks.append(EquationBlock(latex=latex))
            continue

        # 인라인 수식 파싱
        runs = _parse_inline(line)
        if runs:
            section.blocks.append(ParagraphBlock(runs=runs))
        else:
            section.blocks.append(ParagraphBlock(runs=[TextRun(content=line)]))

    return ir_to_hwpx(doc, output_path, template_dir)
