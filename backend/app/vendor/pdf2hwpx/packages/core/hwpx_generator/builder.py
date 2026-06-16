#!/usr/bin/env python3
"""
HWPX Section XML Builder

IR JSON → section0.xml 변환.
텍스트 + 수식(인라인/블록) + 표 삽입을 지원한다.

HWPX 구조:
  <hs:sec> → <hp:p> (paragraph) → <hp:run> → <hp:t> (text) | <hp:equation> (equation)
  수식은 <hp:equation> 안의 <hp:script> 태그에 한컴 수식 스크립트로 삽입
  표는 <hp:tbl> → <hp:tr> → <hp:tc> → <hp:subList> → <hp:p> 구조
"""

import html

try:
    from .xml_constants import (
        NAMESPACES,
        DEFAULT_LINE_HEIGHT, DEFAULT_BASELINE, DEFAULT_SPACING,
        DEFAULT_CELL_HEIGHT, DEFAULT_CELL_MARGIN,
        DEFAULT_TABLE_BORDER_FILL, DEFAULT_CELL_BORDER_FILL,
        EQ_LINE_HEIGHT, EQ_BASELINE, EQ_SPACING,
        DEFAULT_HORZ_SIZE,
        TEMPLATES,
        _gen_id,
    )
except ImportError:
    from xml_constants import (
        NAMESPACES,
        DEFAULT_LINE_HEIGHT, DEFAULT_BASELINE, DEFAULT_SPACING,
        DEFAULT_CELL_HEIGHT, DEFAULT_CELL_MARGIN,
        DEFAULT_TABLE_BORDER_FILL, DEFAULT_CELL_BORDER_FILL,
        EQ_LINE_HEIGHT, EQ_BASELINE, EQ_SPACING,
        DEFAULT_HORZ_SIZE,
        TEMPLATES,
        _gen_id,
    )


class SectionBuilder:
    """section0.xml을 생성하는 빌더."""

    def __init__(self, page_width=59528, page_height=84186,
                 margin_left=5669, margin_right=5669,
                 margin_top=4251, margin_bottom=2834,
                 columns=1, col_gap=1134, landscape="WIDELY"):
        self.page_width = page_width
        self.page_height = page_height
        self.margin_left = margin_left
        self.margin_right = margin_right
        self.margin_top = margin_top
        self.margin_bottom = margin_bottom
        self.landscape = landscape
        self.columns = columns
        self.col_gap = col_gap
        self.paragraphs = []
        self._eq_zorder = 0
        self._full_horz = page_width - margin_left - margin_right
        if columns > 1:
            self._horz_size = (self._full_horz - col_gap * (columns - 1)) // columns
        else:
            self._horz_size = self._full_horz

    def add_paragraph(self, text: str, char_pr_id: str = "0",
                      para_pr_id: str = "0", style_id: str = "0"):
        """단순 텍스트 문단 추가"""
        self.paragraphs.append({
            "type": "simple",
            "text": text,
            "charPrIDRef": char_pr_id,
            "paraPrIDRef": para_pr_id,
            "styleIDRef": style_id,
        })

    def add_rich_paragraph(self, runs: list, para_pr_id: str = "0",
                           style_id: str = "0"):
        """수식+텍스트 혼합 문단 추가

        Args:
            runs: list of dicts:
                - {"type": "text", "content": str}
                - {"type": "equation", "script": str}
                - {"type": "equation", "script": str, "inline": False}
        """
        self.paragraphs.append({
            "type": "rich",
            "runs": runs,
            "paraPrIDRef": para_pr_id,
            "styleIDRef": style_id,
        })

    def add_heading(self, text: str, level: int = 1):
        """제목 문단 추가"""
        self.paragraphs.append({
            "type": "simple",
            "text": text,
            "charPrIDRef": "0",
            "paraPrIDRef": str(level),
            "styleIDRef": str(level),
        })

    def add_image(self, bin_id: str, width: int, height: int):
        """이미지 문단 추가

        Args:
            bin_id: BinData 내 파일명 (예: "image1.png")
            width: 이미지 가로 크기 (HWPUNIT)
            height: 이미지 세로 크기 (HWPUNIT)
        """
        # 다단 폭 초과 시 표시 높이를 미리 계산 (vertpos 산출용)
        disp_h = height
        if width > self._horz_size:
            disp_h = int(height * (self._horz_size / width))
        self.paragraphs.append({
            "type": "image",
            "bin_id": bin_id,
            "width": width,
            "height": height,
            "disp_height": disp_h,
        })

    def add_column_break(self):
        """단 나누기 (다음 단으로 이동)"""
        self.paragraphs.append({"type": "column_break"})

    def add_page_break(self):
        """페이지 나누기"""
        self.paragraphs.append({"type": "page_break"})

    def _has_equation(self, para_data: dict) -> bool:
        """문단에 수식이 포함되어 있는지 확인"""
        if para_data["type"] == "rich":
            return any(r["type"] == "equation" for r in para_data.get("runs", []))
        return False

    def _build_lineseg(self, vertpos: int, has_eq: bool = False) -> str:
        """linesegarray XML 생성 — 한/글이 문단 높이를 올바르게 계산하도록
        horzsize=0으로 두면 한/글이 열 때 자동 재계산 (줄바꿈 정상 처리)"""
        if has_eq:
            h = EQ_LINE_HEIGHT
            bl = EQ_BASELINE
            sp = EQ_SPACING
        else:
            h = DEFAULT_LINE_HEIGHT
            bl = DEFAULT_BASELINE
            sp = DEFAULT_SPACING
        return (
            f'<hp:linesegarray>'
            f'<hp:lineseg textpos="0" vertpos="{vertpos}" '
            f'vertsize="{h}" textheight="{h}" baseline="{bl}" '
            f'spacing="{sp}" horzpos="0" horzsize="0" '
            f'flags="393216"/>'
            f'</hp:linesegarray>'
        )

    def _build_sec_pr(self):
        """섹션 속성(페이지 설정) XML"""
        return (
            f'<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" '
            f'tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" '
            f'outlineShapeIDRef="1" memoShapeIDRef="1" textVerticalWidthHead="0" masterPageCnt="0">'
            f'<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>'
            f'<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
            f'<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" '
            f'border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
            f'<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>'
            f'<hp:pagePr landscape="{self.landscape}" width="{self.page_width}" height="{self.page_height}" gutterType="LEFT_ONLY">'
            f'<hp:margin header="0" footer="4252" gutter="0" '
            f'left="{self.margin_left}" right="{self.margin_right}" '
            f'top="{self.margin_top}" bottom="{self.margin_bottom}"/>'
            f'</hp:pagePr>'
            f'<hp:footNotePr>'
            f'<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
            f'<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>'
            f'<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>'
            f'<hp:numbering type="CONTINUOUS" newNum="1"/>'
            f'<hp:placement place="EACH_COLUMN" beneathText="0"/>'
            f'</hp:footNotePr>'
            f'<hp:endNotePr>'
            f'<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>'
            f'<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>'
            f'<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>'
            f'<hp:numbering type="CONTINUOUS" newNum="1"/>'
            f'<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>'
            f'</hp:endNotePr>'
            f'<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" '
            f'headerInside="0" footerInside="0" fillArea="PAPER">'
            f'<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>'
            f'</hp:pageBorderFill>'
            f'<hp:pageBorderFill type="EVEN" borderFillIDRef="1" textBorder="PAPER" '
            f'headerInside="0" footerInside="0" fillArea="PAPER">'
            f'<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>'
            f'</hp:pageBorderFill>'
            f'<hp:pageBorderFill type="ODD" borderFillIDRef="1" textBorder="PAPER" '
            f'headerInside="0" footerInside="0" fillArea="PAPER">'
            f'<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>'
            f'</hp:pageBorderFill>'
            f'</hp:secPr>'
            f'{self._build_col_ctrl()}'
        )

    def _build_col_ctrl(self) -> str:
        """다단 컨트롤 XML 생성 — secPr 밖, run 안의 <hp:ctrl> 형태
        한/글 참조 HWPX와 동일하게 self-closing <hp:colPr/> 사용"""
        if self.columns <= 1:
            return ''
        return (
            f'<hp:ctrl>'
            f'<hp:colPr id="" type="NEWSPAPER" layout="LEFT" '
            f'colCount="{self.columns}" sameSz="1" sameGap="{self.col_gap}"/>'
            f'</hp:ctrl>'
        )

    def _build_image_xml(self, bin_id: str, width: int, height: int) -> str:
        """이미지(그림) XML 태그 생성 — 한/글 실제 HWPX 구조 기반"""
        self._eq_zorder += 1
        pic_id = _gen_id()
        inst_id = _gen_id()
        item_id = bin_id.rsplit(".", 1)[0] if "." in bin_id else bin_id

        # 원본 크기 보존
        org_w, org_h = width, height

        # 다단 폭을 넘지 않도록 표시 크기 축소 (비율 유지)
        disp_w, disp_h = width, height
        if disp_w > self._horz_size:
            ratio = self._horz_size / disp_w
            disp_w = self._horz_size
            disp_h = int(disp_h * ratio)

        cx = disp_w // 2
        cy = disp_h // 2

        return (
            f'<hp:pic id="{pic_id}" zOrder="{self._eq_zorder}" '
            f'numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" '
            f'lock="0" dropcapstyle="None" href="" groupLevel="0" '
            f'instid="{inst_id}" reverse="0">'
            f'<hp:offset x="0" y="0"/>'
            f'<hp:orgSz width="{org_w}" height="{org_h}"/>'
            f'<hp:curSz width="{disp_w}" height="{disp_h}"/>'
            f'<hp:flip horizontal="0" vertical="0"/>'
            f'<hp:rotationInfo angle="0" centerX="{cx}" centerY="{cy}" rotateimage="1"/>'
            f'<hp:renderingInfo>'
            f'<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'</hp:renderingInfo>'
            f'<hp:imgRect>'
            f'<hc:pt0 x="0" y="0"/>'
            f'<hc:pt1 x="{org_w}" y="0"/>'
            f'<hc:pt2 x="{org_w}" y="{org_h}"/>'
            f'<hc:pt3 x="0" y="{org_h}"/>'
            f'</hp:imgRect>'
            f'<hp:imgClip left="0" right="{org_w}" top="0" bottom="{org_h}"/>'
            f'<hp:inMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hc:img binaryItemIDRef="{item_id}" bright="0" contrast="0" '
            f'effect="REAL_PIC" alpha="0"/>'
            f'<hp:effects/>'
            f'<hp:sz width="{disp_w}" widthRelTo="ABSOLUTE" '
            f'height="{disp_h}" heightRelTo="ABSOLUTE" protect="0"/>'
            f'<hp:pos treatAsChar="1" affectLSpacing="0" '
            f'flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
            f'vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" '
            f'vertOffset="0" horzOffset="0"/>'
            f'<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:shapeComment></hp:shapeComment>'
            f'</hp:pic>'
        )

    def _build_image_paragraph_xml(self, para_data: dict, vertpos: int,
                                    include_sec_pr: bool = False) -> str:
        """이미지를 포함하는 문단 XML 생성"""
        p_id = _gen_id()
        bin_id = para_data["bin_id"]
        width = para_data["width"]
        height = para_data["height"]
        col_brk = "1" if para_data.get("_columnBreak") else "0"
        pg_brk = "1" if para_data.get("_pageBreak") else "0"

        parts = []
        parts.append(
            f'<hp:p id="{p_id}" paraPrIDRef="0" styleIDRef="0" '
            f'pageBreak="{pg_brk}" columnBreak="{col_brk}" merged="0">'
        )
        if include_sec_pr:
            parts.append('<hp:run charPrIDRef="0">')
            parts.append(self._build_sec_pr())
            parts.append('</hp:run>')
        parts.append('<hp:run charPrIDRef="0">')
        parts.append(self._build_image_xml(bin_id, width, height))
        parts.append('</hp:run>')
        parts.append(self._build_lineseg(vertpos, has_eq=False))
        parts.append('</hp:p>')
        return ''.join(parts)

    def _build_equation_xml(self, script: str, inline: bool = True,
                            base_unit: str = "1000", font: str = "HancomEQN") -> str:
        """수식 XML 태그 생성"""
        self._eq_zorder += 1
        eq_id = _gen_id()

        # 수식 스크립트: XML 특수문자 이스케이프
        # 단, &와 <는 한컴 수식에서 열구분자/비교연산자로 쓰이므로
        # 원본 HWPX에서도 이스케이프 없이 들어감 → 이스케이프하지 않음
        # (한/글의 XML 파서가 script 태그 내에서 이를 허용)
        escaped_script = script

        # sz width/height를 0으로 설정하면 한/글이 문서 열 때 자동 재계산
        # baseLine도 0으로 두면 한/글이 재계산
        return (
            f'<hp:equation id="{eq_id}" zOrder="{self._eq_zorder}" '
            f'numberingType="EQUATION" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" '
            f'lock="0" dropcapstyle="None" version="Equation Version 60" '
            f'baseLine="0" textColor="#000000" baseUnit="{base_unit}" '
            f'lineMode="CHAR" font="{font}">'
            f'<hp:sz width="0" widthRelTo="ABSOLUTE" '
            f'height="0" heightRelTo="ABSOLUTE" protect="0"/>'
            f'<hp:pos treatAsChar="1" affectLSpacing="0" '
            f'flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
            f'vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
            f'vertOffset="0" horzOffset="0"/>'
            f'<hp:outMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:shapeComment></hp:shapeComment>'
            f'<hp:script><![CDATA[{escaped_script}]]></hp:script>'
            f'</hp:equation>'
        )

    def _build_runs_xml(self, runs: list) -> str:
        """run 리스트 → XML 문자열"""
        parts = []
        for run in runs:
            if run["type"] == "text":
                text = html.escape(run["content"])
                char_pr = run.get("charPrIDRef", "0")
                parts.append(
                    f'<hp:run charPrIDRef="{char_pr}">'
                    f'<hp:t>{text}</hp:t>'
                    f'</hp:run>'
                )
            elif run["type"] == "equation":
                inline = run.get("inline", True)
                base_unit = run.get("baseUnit", "1000")
                font = run.get("font", "HancomEQN")
                char_pr = run.get("charPrIDRef", "0")
                eq_xml = self._build_equation_xml(
                    run["script"], inline=inline,
                    base_unit=base_unit, font=font
                )
                parts.append(
                    f'<hp:run charPrIDRef="{char_pr}">'
                    f'{eq_xml}'
                    f'</hp:run>'
                )
        return ''.join(parts)

    def _build_paragraph_xml(self, para_data: dict, vertpos: int,
                             include_sec_pr: bool = False) -> str:
        """단일 문단 XML 생성"""
        p_id = _gen_id()
        para_pr = para_data.get("paraPrIDRef", "0")
        style_id = para_data.get("styleIDRef", "0")
        has_eq = self._has_equation(para_data)

        col_brk = "1" if para_data.get("_columnBreak") else "0"
        pg_brk = "1" if para_data.get("_pageBreak") else "0"

        parts = []
        parts.append(
            f'<hp:p id="{p_id}" paraPrIDRef="{para_pr}" '
            f'styleIDRef="{style_id}" pageBreak="{pg_brk}" columnBreak="{col_brk}" merged="0">'
        )

        if para_data["type"] == "simple":
            text = html.escape(para_data["text"])
            char_pr = para_data.get("charPrIDRef", "0")
            if include_sec_pr:
                # secPr+ctrl은 별도 run, 텍스트는 다음 run (한/글 참조 구조)
                parts.append(f'<hp:run charPrIDRef="{char_pr}">')
                parts.append(self._build_sec_pr())
                parts.append('</hp:run>')
                parts.append(f'<hp:run charPrIDRef="{char_pr}">')
                parts.append(f'<hp:t>{text}</hp:t>')
                parts.append('</hp:run>')
            else:
                parts.append(f'<hp:run charPrIDRef="{char_pr}">')
                parts.append(f'<hp:t>{text}</hp:t>')
                parts.append('</hp:run>')

        elif para_data["type"] == "rich":
            runs = para_data.get("runs", [])
            if include_sec_pr:
                # secPr+ctrl은 별도 run (한/글 참조 구조)
                parts.append('<hp:run charPrIDRef="0">')
                parts.append(self._build_sec_pr())
                parts.append('</hp:run>')
                # 이후 일반 runs
                parts.append(self._build_runs_xml(runs))
            else:
                parts.append(self._build_runs_xml(runs))

        # linesegarray 추가 — 문단 높이 정보
        parts.append(self._build_lineseg(vertpos, has_eq))
        parts.append('</hp:p>')

        return ''.join(parts)

    def add_section_change(self, columns: int):
        """섹션 전환 (다단 수 변경) — 새 페이지에서 시작"""
        self.paragraphs.append({
            "type": "section_change",
            "columns": columns,
        })

    def add_table(self, rows: list, col_widths: list,
                  row_height: int = DEFAULT_CELL_HEIGHT,
                  cell_margin: int = DEFAULT_CELL_MARGIN,
                  border_fill: str = DEFAULT_TABLE_BORDER_FILL,
                  cell_border_fill: str = DEFAULT_CELL_BORDER_FILL):
        """표 문단 추가

        Args:
            rows: 2D list. 각 셀은 str(텍스트) 또는 dict(수식) 가능.
                  str → 일반 텍스트
                  dict → {"type": "equation", "script": str} 형태
            col_widths: 각 열의 너비 (HWPUNIT). 예: [8000, 20000, 20000]
            row_height: 각 행 높이 (HWPUNIT). 기본 1600
            cell_margin: 셀 여백 (HWPUNIT). 기본 141
            border_fill: 표 전체 borderFillIDRef
            cell_border_fill: 개별 셀 borderFillIDRef
        """
        # 표 폭이 다단 폭을 넘으면 비례 축소
        table_width = sum(col_widths)
        if table_width > self._horz_size:
            ratio = self._horz_size / table_width
            col_widths = [int(w * ratio) for w in col_widths]

        self.paragraphs.append({
            "type": "table",
            "rows": rows,
            "col_widths": col_widths,
            "row_height": row_height,
            "cell_margin": cell_margin,
            "border_fill": border_fill,
            "cell_border_fill": cell_border_fill,
        })

    def _build_cell_content_xml(self, cell_data, cell_width: int) -> str:
        """셀 내용물(텍스트, 수식, 또는 rich runs)에 대한 paragraph XML 생성"""
        p_id = _gen_id()
        content_width = cell_width

        # rich runs 리스트: [{"type":"text","content":"..."}, {"type":"equation","script":"..."}]
        if isinstance(cell_data, list):
            run_parts = []
            has_eq = False
            for run in cell_data:
                if run.get("type") == "equation":
                    has_eq = True
                    eq_xml = self._build_equation_xml(
                        run["script"], inline=True,
                        base_unit=run.get("baseUnit", "1000"),
                        font=run.get("font", "HancomEQN"),
                    )
                    run_parts.append(f'<hp:run charPrIDRef="0">{eq_xml}</hp:run>')
                else:
                    text = html.escape(str(run.get("content", "")))
                    if text:
                        run_parts.append(f'<hp:run charPrIDRef="0"><hp:t>{text}</hp:t></hp:run>')
            run_xml = ''.join(run_parts)
            if has_eq:
                lineseg = (
                    f'<hp:linesegarray>'
                    f'<hp:lineseg textpos="0" vertpos="0" '
                    f'vertsize="{EQ_LINE_HEIGHT}" textheight="{EQ_LINE_HEIGHT}" '
                    f'baseline="{EQ_BASELINE}" spacing="{EQ_SPACING}" '
                    f'horzpos="0" horzsize="{content_width}" flags="393216"/>'
                    f'</hp:linesegarray>'
                )
            else:
                lineseg = (
                    f'<hp:linesegarray>'
                    f'<hp:lineseg textpos="0" vertpos="0" '
                    f'vertsize="{DEFAULT_LINE_HEIGHT}" textheight="{DEFAULT_LINE_HEIGHT}" '
                    f'baseline="{DEFAULT_BASELINE}" spacing="{DEFAULT_SPACING}" '
                    f'horzpos="0" horzsize="{content_width}" flags="393216"/>'
                    f'</hp:linesegarray>'
                )
        elif isinstance(cell_data, dict) and cell_data.get("type") == "equation":
            eq_xml = self._build_equation_xml(
                cell_data["script"], inline=True,
                base_unit=cell_data.get("baseUnit", "1000"),
                font=cell_data.get("font", "HancomEQN"),
            )
            run_xml = (
                f'<hp:run charPrIDRef="0">'
                f'{eq_xml}'
                f'</hp:run>'
            )
            lineseg = (
                f'<hp:linesegarray>'
                f'<hp:lineseg textpos="0" vertpos="0" '
                f'vertsize="{EQ_LINE_HEIGHT}" textheight="{EQ_LINE_HEIGHT}" '
                f'baseline="{EQ_BASELINE}" spacing="{EQ_SPACING}" '
                f'horzpos="0" horzsize="{content_width}" flags="393216"/>'
                f'</hp:linesegarray>'
            )
        else:
            text = html.escape(str(cell_data)) if cell_data else ""
            run_xml = (
                f'<hp:run charPrIDRef="0">'
                f'<hp:t>{text}</hp:t>'
                f'</hp:run>'
            )
            lineseg = (
                f'<hp:linesegarray>'
                f'<hp:lineseg textpos="0" vertpos="0" '
                f'vertsize="{DEFAULT_LINE_HEIGHT}" textheight="{DEFAULT_LINE_HEIGHT}" '
                f'baseline="{DEFAULT_BASELINE}" spacing="{DEFAULT_SPACING}" '
                f'horzpos="0" horzsize="{content_width}" flags="393216"/>'
                f'</hp:linesegarray>'
            )

        return (
            f'<hp:p id="{p_id}" paraPrIDRef="0" styleIDRef="0" '
            f'pageBreak="0" columnBreak="0" merged="0">'
            f'{run_xml}'
            f'{lineseg}'
            f'</hp:p>'
        )

    def _build_table_xml(self, para_data: dict) -> str:
        """표 XML 생성 — <hp:tbl> 구조"""
        rows = para_data["rows"]
        col_widths = para_data["col_widths"]
        row_height = para_data["row_height"]
        cell_margin = para_data["cell_margin"]
        border_fill = para_data["border_fill"]
        cell_border_fill = para_data["cell_border_fill"]

        row_cnt = len(rows)
        col_cnt = len(col_widths)
        table_width = sum(col_widths)

        # row_height가 리스트면 행별 높이, 스칼라면 전체 동일
        if isinstance(row_height, (list, tuple)):
            row_heights = list(row_height)
            while len(row_heights) < row_cnt:
                row_heights.append(row_heights[-1] if row_heights else DEFAULT_CELL_HEIGHT)
        else:
            row_heights = [row_height] * row_cnt
        table_height = sum(row_heights)

        tbl_id = _gen_id()
        self._eq_zorder += 1

        parts = []
        parts.append(
            f'<hp:tbl id="{tbl_id}" zOrder="{self._eq_zorder}" '
            f'numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" '
            f'lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" '
            f'rowCnt="{row_cnt}" colCnt="{col_cnt}" cellSpacing="0" '
            f'borderFillIDRef="{border_fill}" noAdjust="0">'
        )

        # 표 크기
        parts.append(
            f'<hp:sz width="{table_width}" widthRelTo="ABSOLUTE" '
            f'height="{table_height}" heightRelTo="ABSOLUTE" protect="0"/>'
        )

        # 위치 (treatAsChar=1: 글자처럼 취급)
        parts.append(
            '<hp:pos treatAsChar="1" affectLSpacing="0" '
            'flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" '
            'vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" '
            'vertOffset="0" horzOffset="0"/>'
        )

        # 표 외부/내부 여백
        parts.append(
            f'<hp:outMargin left="{cell_margin}" right="{cell_margin}" '
            f'top="{cell_margin}" bottom="{cell_margin}"/>'
        )
        parts.append(
            f'<hp:inMargin left="{cell_margin}" right="{cell_margin}" '
            f'top="{cell_margin}" bottom="{cell_margin}"/>'
        )

        # 행/셀 생성
        for row_idx, row in enumerate(rows):
            parts.append('<hp:tr>')
            for col_idx in range(col_cnt):
                cell_data = row[col_idx] if col_idx < len(row) else ""
                cell_width = col_widths[col_idx]

                parts.append(
                    f'<hp:tc name="" header="0" hasMargin="0" protect="0" '
                    f'editable="0" dirty="0" borderFillIDRef="{cell_border_fill}">'
                )

                # subList: 셀 내 문단 컨테이너
                parts.append(
                    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" '
                    'vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" '
                    'textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
                )

                # 셀 내용 (paragraph)
                parts.append(self._build_cell_content_xml(cell_data, cell_width))

                parts.append('</hp:subList>')

                # 셀 주소, 병합, 크기, 여백
                parts.append(f'<hp:cellAddr colAddr="{col_idx}" rowAddr="{row_idx}"/>')
                parts.append('<hp:cellSpan colSpan="1" rowSpan="1"/>')
                parts.append(f'<hp:cellSz width="{cell_width}" height="{row_heights[row_idx]}"/>')
                parts.append(
                    f'<hp:cellMargin left="{cell_margin}" right="{cell_margin}" '
                    f'top="{cell_margin}" bottom="{cell_margin}"/>'
                )

                parts.append('</hp:tc>')
            parts.append('</hp:tr>')

        parts.append('</hp:tbl>')
        return ''.join(parts)

    def _build_table_paragraph_xml(self, para_data: dict, vertpos: int,
                                    include_sec_pr: bool = False) -> str:
        """표를 포함하는 문단 XML 생성

        표는 문단의 run 안에 <hp:tbl> 태그로 삽입된다.
        """
        p_id = _gen_id()
        col_brk = "1" if para_data.get("_columnBreak") else "0"
        pg_brk = "1" if para_data.get("_pageBreak") else "0"

        parts = []
        parts.append(
            f'<hp:p id="{p_id}" paraPrIDRef="0" styleIDRef="0" '
            f'pageBreak="{pg_brk}" columnBreak="{col_brk}" merged="0">'
        )

        if include_sec_pr:
            parts.append('<hp:run charPrIDRef="0">')
            parts.append(self._build_sec_pr())
            parts.append('</hp:run>')
        parts.append('<hp:run charPrIDRef="0">')
        parts.append(self._build_table_xml(para_data))
        parts.append('</hp:run>')

        # linesegarray
        parts.append(self._build_lineseg(vertpos, has_eq=False))
        parts.append('</hp:p>')

        return ''.join(parts)

    def build(self) -> str:
        """전체 section0.xml 문자열 생성"""
        parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>']

        ns_attrs = ' '.join(
            f'xmlns:{prefix}="{uri}"' for prefix, uri in NAMESPACES.items()
        )
        parts.append(f'<hs:sec {ns_attrs}>')

        # 누적 vertpos 계산
        vertpos = 0

        if self.paragraphs:
            # 첫 문단 (secPr 포함)
            first = self.paragraphs[0]
            if first["type"] == "table":
                parts.append(self._build_table_paragraph_xml(first, vertpos, include_sec_pr=True))
                rh = first["row_height"]
                table_height = sum(rh) if isinstance(rh, (list, tuple)) else rh * len(first["rows"])
                vertpos += table_height + DEFAULT_SPACING
            elif first["type"] == "image":
                parts.append(self._build_image_paragraph_xml(first, vertpos, include_sec_pr=True))
                vertpos += first["height"] + DEFAULT_SPACING
            else:
                parts.append(self._build_paragraph_xml(first, vertpos, include_sec_pr=True))
                has_eq = self._has_equation(first)
                vertpos += (EQ_LINE_HEIGHT + EQ_SPACING) if has_eq else (DEFAULT_LINE_HEIGHT + DEFAULT_SPACING)

            # 나머지 문단
            next_col_break = False
            next_page_break = False
            next_sec_change = False
            for para in self.paragraphs[1:]:
                if para["type"] == "column_break":
                    next_col_break = True
                    continue
                if para["type"] == "page_break":
                    next_page_break = True
                    continue
                if para["type"] == "section_change":
                    # 다단 수 변경: 내부 상태 갱신
                    new_cols = para["columns"]
                    self.columns = new_cols
                    self._full_horz = self.page_width - self.margin_left - self.margin_right
                    if new_cols > 1:
                        self._horz_size = (self._full_horz - self.col_gap * (new_cols - 1)) // new_cols
                    else:
                        self._horz_size = self._full_horz
                    next_sec_change = True
                    next_page_break = True
                    continue

                # break 속성을 다음 실제 문단에 직접 설정 (빈 문단 삽입 X)
                if next_col_break:
                    para["_columnBreak"] = True
                    next_col_break = False
                if next_page_break:
                    para["_pageBreak"] = True
                    next_page_break = False

                # 섹션 전환: 다음 실제 문단에 새 secPr 삽입
                include_new_sec = next_sec_change
                if next_sec_change:
                    next_sec_change = False
                    vertpos = 0

                if para["type"] == "table":
                    parts.append(self._build_table_paragraph_xml(para, vertpos, include_sec_pr=include_new_sec))
                    rh = para["row_height"]
                    table_height = sum(rh) if isinstance(rh, (list, tuple)) else rh * len(para["rows"])
                    vertpos += table_height + DEFAULT_SPACING
                elif para["type"] == "image":
                    parts.append(self._build_image_paragraph_xml(para, vertpos, include_sec_pr=include_new_sec))
                    vertpos += para.get("disp_height", para["height"]) + DEFAULT_SPACING
                else:
                    parts.append(self._build_paragraph_xml(para, vertpos, include_sec_pr=include_new_sec))
                    has_eq = self._has_equation(para)
                    vertpos += (EQ_LINE_HEIGHT + EQ_SPACING) if has_eq else (DEFAULT_LINE_HEIGHT + DEFAULT_SPACING)
        else:
            parts.append(self._build_paragraph_xml(
                {"type": "simple", "text": "", "charPrIDRef": "0",
                 "paraPrIDRef": "0", "styleIDRef": "0"},
                vertpos, include_sec_pr=True
            ))

        parts.append('</hs:sec>')
        return ''.join(parts)
