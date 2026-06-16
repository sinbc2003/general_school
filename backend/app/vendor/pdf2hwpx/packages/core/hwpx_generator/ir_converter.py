"""
DocumentIR -> HWPX 변환기

DocumentIR(packages/core/ir/schema.py)를 받아
builder.py + packager.py를 사용하여 HWPX 파일을 생성한다.

Usage:
    from packages.core.hwpx_generator.ir_converter import ir_to_hwpx, latex_doc_to_hwpx

    # IR 객체에서 직접 변환
    ir_to_hwpx(doc_ir, "output.hwpx")

    # LaTeX 포함 텍스트에서 간편 변환
    latex_doc_to_hwpx("이차방정식 $x^2+1=0$의 풀이", "output.hwpx")
"""

import re
import sys
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가 (독립 실행 시 임포트 해결)
_PROJECT_ROOT = str(Path(__file__).resolve().parents[3])
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from packages.core.ir.schema import (
    DocumentIR, Section, Block, BlockType, InlineRun, InlineType,
)
from packages.core.hwpx_generator.builder import SectionBuilder
from packages.core.hwpx_generator.packager import package_hwpx
from packages.core.equation_converter.rules import LatexToHwpRules

# 모듈 레벨 변환기 인스턴스 (재사용)
_l2h = LatexToHwpRules()


def _latex_to_hwp_script(latex: str) -> str:
    """LaTeX 수식 문자열을 HWP 수식 스크립트로 변환한다.

    앞뒤 $ 기호가 있으면 제거한 뒤 변환한다.
    """
    s = latex.strip()
    # $$ ... $$ 또는 $ ... $ 제거
    if s.startswith("$$") and s.endswith("$$"):
        s = s[2:-2].strip()
    elif s.startswith("$") and s.endswith("$"):
        s = s[1:-1].strip()
    return _l2h.convert(s)


def _inline_runs_to_builder_runs(runs: list[InlineRun]) -> list[dict]:
    """IR InlineRun 리스트를 SectionBuilder의 rich paragraph run 포맷으로 변환한다.

    Returns:
        list of dicts:
            {"type": "text", "content": str}
            {"type": "equation", "script": str, "inline": True}
    """
    builder_runs = []
    for run in runs:
        if run.type == InlineType.TEXT:
            if run.content:
                builder_runs.append({"type": "text", "content": run.content})
        elif run.type == InlineType.EQUATION_INLINE:
            script = _latex_to_hwp_script(run.latex)
            if script:
                builder_runs.append({
                    "type": "equation",
                    "script": script,
                    "inline": True,
                })
    return builder_runs


def _has_equations(runs: list[InlineRun]) -> bool:
    """InlineRun 리스트에 수식이 포함되어 있는지 확인한다."""
    return any(r.type == InlineType.EQUATION_INLINE for r in runs)


def _process_block(sb: SectionBuilder, block: Block) -> None:
    """단일 Block을 SectionBuilder에 추가한다."""

    if block.type == BlockType.PARAGRAPH:
        if not block.runs:
            # 빈 문단 — 빈 줄 역할
            sb.add_paragraph("")
            return

        if _has_equations(block.runs):
            # 수식이 포함된 혼합 문단
            builder_runs = _inline_runs_to_builder_runs(block.runs)
            if builder_runs:
                sb.add_rich_paragraph(builder_runs)
            else:
                sb.add_paragraph("")
        else:
            # 순수 텍스트 문단 — 모든 run의 content를 합침
            text = "".join(r.content for r in block.runs)
            sb.add_paragraph(text)

    elif block.type == BlockType.HEADING:
        # 제목: run들의 텍스트를 합침
        text = "".join(r.content for r in block.runs if r.type == InlineType.TEXT)
        sb.add_heading(text, level=block.level)

    elif block.type == BlockType.EQUATION_BLOCK:
        # 블록 수식 — 독립 행 수식
        script = _latex_to_hwp_script(block.latex)
        if script:
            sb.add_rich_paragraph([{
                "type": "equation",
                "script": script,
                "inline": False,
            }])
        else:
            # 변환 실패 시 원본 LaTeX를 텍스트로 삽입
            sb.add_paragraph(block.latex)

    elif block.type == BlockType.TABLE:
        # 표 데이터를 builder의 add_table로 전달
        table_rows = []
        for row in block.rows:
            table_row = []
            for cell in row.cells:
                if len(cell.runs) == 1 and cell.runs[0].type == InlineType.EQUATION_INLINE:
                    # 수식만 있는 셀
                    script = _latex_to_hwp_script(cell.runs[0].latex)
                    table_row.append({"type": "equation", "script": script})
                else:
                    # 텍스트 셀 (수식 포함 가능하지만 우선 텍스트로)
                    text = "".join(
                        r.content if r.type == InlineType.TEXT else r.latex
                        for r in cell.runs
                    )
                    table_row.append(text)
            table_rows.append(table_row)

        # 열 너비 계산: 균등 분배
        col_cnt = max(len(r) for r in table_rows) if table_rows else 1
        avail_width = 48190  # A4 본문 너비
        col_width = avail_width // col_cnt
        col_widths = [col_width] * col_cnt

        sb.add_table(table_rows, col_widths)

    elif block.type == BlockType.IMAGE:
        # TODO: Phase 2 — 이미지 삽입 구현
        sb.add_paragraph(f"[이미지: {block.src}]")


def ir_to_hwpx(doc: DocumentIR, output_path: str, title: str = "문서") -> str:
    """DocumentIR을 HWPX 파일로 변환한다.

    Args:
        doc: DocumentIR 객체
        output_path: 출력 HWPX 파일 경로
        title: 문서 제목 (HWPX 메타데이터에 사용)

    Returns:
        생성된 HWPX 파일의 절대 경로
    """
    # 메타데이터에서 제목 가져오기 (인자가 기본값이면)
    if title == "문서" and doc.metadata.get("title"):
        title = doc.metadata["title"]

    # 섹션이 없으면 빈 문서 생성
    if not doc.sections:
        sb = SectionBuilder()
        sb.add_paragraph("")
        section_xml = sb.build()
        return package_hwpx(section_xml, output_path, title=title)

    # 첫 번째 섹션 처리 (HWPX는 기본적으로 단일 섹션)
    # 여러 섹션이 있으면 모두 하나의 SectionBuilder에 합침
    sb = SectionBuilder()

    for section in doc.sections:
        for block in section.blocks:
            _process_block(sb, block)

    section_xml = sb.build()
    return package_hwpx(section_xml, output_path, title=title)


# ── 텍스트 파싱 유틸리티 ──

# 블록 수식: $$...$$
_BLOCK_EQ_RE = re.compile(r'\$\$(.+?)\$\$', re.DOTALL)
# 인라인 수식: $...$  ($$는 제외)
_INLINE_EQ_RE = re.compile(r'(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)')


def _parse_paragraph_text(text: str) -> list[InlineRun]:
    """텍스트에서 인라인 수식($...$)을 감지하여 InlineRun 리스트로 변환한다."""
    runs = []
    last_end = 0

    for m in _INLINE_EQ_RE.finditer(text):
        # 수식 앞 텍스트
        if m.start() > last_end:
            runs.append(InlineRun(
                type=InlineType.TEXT,
                content=text[last_end:m.start()],
            ))
        # 수식
        runs.append(InlineRun(
            type=InlineType.EQUATION_INLINE,
            latex=m.group(1).strip(),
        ))
        last_end = m.end()

    # 나머지 텍스트
    if last_end < len(text):
        runs.append(InlineRun(
            type=InlineType.TEXT,
            content=text[last_end:],
        ))

    return runs


def _parse_text_to_ir(text: str) -> DocumentIR:
    """LaTeX 수식이 포함된 텍스트를 DocumentIR로 파싱한다.

    - 빈 줄로 문단을 구분한다.
    - $$...$$ 는 블록 수식(EQUATION_BLOCK)으로 처리한다.
    - $...$ 는 인라인 수식으로 처리한다.
    """
    blocks = []

    # 먼저 $$...$$ 블록 수식을 분리
    parts = _BLOCK_EQ_RE.split(text)
    # parts: [텍스트, 수식내용, 텍스트, 수식내용, ...]
    # 홀수 인덱스가 수식 내용

    for i, part in enumerate(parts):
        if i % 2 == 1:
            # 블록 수식
            blocks.append(Block(
                type=BlockType.EQUATION_BLOCK,
                latex=part.strip(),
            ))
        else:
            # 텍스트 부분 — 빈 줄로 문단 분리
            paragraphs = re.split(r'\n\s*\n', part)
            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue
                # 단일 행 내의 줄바꿈은 공백으로 치환
                para = re.sub(r'\s*\n\s*', ' ', para)
                runs = _parse_paragraph_text(para)
                if runs:
                    blocks.append(Block(
                        type=BlockType.PARAGRAPH,
                        runs=runs,
                    ))

    return DocumentIR(
        sections=[Section(blocks=blocks)] if blocks else [],
    )


def latex_doc_to_hwpx(text: str, output_path: str) -> str:
    """LaTeX 수식이 포함된 텍스트를 HWPX 파일로 변환한다.

    문단은 빈 줄로 구분한다. $...$ 는 인라인 수식, $$...$$ 는 블록 수식으로 처리한다.

    Args:
        text: LaTeX 수식이 포함된 텍스트
        output_path: 출력 HWPX 파일 경로

    Returns:
        생성된 HWPX 파일의 절대 경로

    Example:
        >>> latex_doc_to_hwpx(
        ...     "이차방정식 $x^2+1=0$의 근은\\n\\n$$x = \\\\pm i$$",
        ...     "output.hwpx"
        ... )
    """
    doc = _parse_text_to_ir(text)
    return ir_to_hwpx(doc, output_path)


if __name__ == "__main__":
    # 간단한 테스트
    sample_text = (
        "이차방정식의 근의 공식은 다음과 같다.\n\n"
        "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\n"
        "여기서 $a \\neq 0$이고, 판별식 $D = b^2 - 4ac$에 따라 근의 개수가 결정된다.\n\n"
        "$D > 0$이면 서로 다른 두 실근, $D = 0$이면 중근, $D < 0$이면 허근을 갖는다."
    )

    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmpdir:
        out = os.path.join(tmpdir, "test_output.hwpx")
        result = latex_doc_to_hwpx(sample_text, out)
        print(f"HWPX 생성 완료: {result}")
        print(f"파일 크기: {os.path.getsize(result)} bytes")

        # IR 파싱 확인
        doc = _parse_text_to_ir(sample_text)
        print(f"\n섹션 수: {len(doc.sections)}")
        for i, section in enumerate(doc.sections):
            print(f"  섹션 {i}: 블록 {len(section.blocks)}개")
            for j, block in enumerate(section.blocks):
                if block.type == BlockType.EQUATION_BLOCK:
                    print(f"    [{j}] EQUATION_BLOCK: {block.latex[:50]}...")
                elif block.type == BlockType.PARAGRAPH:
                    preview = "".join(
                        r.content if r.type == InlineType.TEXT else f"[${r.latex}$]"
                        for r in block.runs
                    )
                    print(f"    [{j}] PARAGRAPH: {preview[:60]}...")
