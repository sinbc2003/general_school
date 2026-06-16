#!/usr/bin/env python3
"""
IR ↔ Tiptap JSON 변환

DocumentIR <-> Tiptap Editor JSON 양방향 변환.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from schema import (
    DocumentIR, DocumentMetadata, Section,
    ParagraphBlock, HeadingBlock, EquationBlock, TableBlock, ImageBlock,
    TextRun, InlineEquation, TableRow,
)


def ir_to_tiptap(doc: DocumentIR) -> dict:
    """DocumentIR → Tiptap JSON 변환"""
    content = []

    for section in doc.sections:
        for block in section.blocks:
            if isinstance(block, HeadingBlock):
                content.append(_heading_to_tiptap(block))
            elif isinstance(block, ParagraphBlock):
                content.append(_paragraph_to_tiptap(block))
            elif isinstance(block, EquationBlock):
                content.append(_equation_block_to_tiptap(block))
            elif isinstance(block, TableBlock):
                content.append(_table_to_tiptap(block))
            elif isinstance(block, ImageBlock):
                content.append(_image_to_tiptap(block))

    return {"type": "doc", "content": content}


def _runs_to_tiptap(runs) -> list:
    """IR runs → Tiptap inline content"""
    content = []
    for run in runs:
        if isinstance(run, TextRun):
            if run.content:
                node = {"type": "text", "text": run.content}
                marks = []
                if run.bold:
                    marks.append({"type": "bold"})
                if run.italic:
                    marks.append({"type": "italic"})
                if marks:
                    node["marks"] = marks
                content.append(node)
        elif isinstance(run, InlineEquation):
            content.append({
                "type": "mathInline",
                "attrs": {"latex": run.latex, "display": False},
            })
    return content


def _heading_to_tiptap(block: HeadingBlock) -> dict:
    content = _runs_to_tiptap(block.runs)
    return {
        "type": "heading",
        "attrs": {"level": block.level},
        "content": content if content else [{"type": "text", "text": " "}],
    }


def _paragraph_to_tiptap(block: ParagraphBlock) -> dict:
    content = _runs_to_tiptap(block.runs)
    return {
        "type": "paragraph",
        "content": content if content else [{"type": "text", "text": " "}],
    }


def _equation_block_to_tiptap(block: EquationBlock) -> dict:
    return {
        "type": "mathBlock",
        "attrs": {"latex": block.latex, "display": True},
    }


def _table_to_tiptap(block: TableBlock) -> dict:
    """표 → Tiptap table 노드 (또는 텍스트 폴백)"""
    # Tiptap table 구조로 변환
    rows = []
    for i, row in enumerate(block.rows):
        cells = []
        for cell in row.cells:
            cell_content = _runs_to_tiptap(cell)
            cell_type = "tableHeader" if i == 0 else "tableCell"
            cells.append({
                "type": cell_type,
                "content": [{
                    "type": "paragraph",
                    "content": cell_content if cell_content else [{"type": "text", "text": " "}],
                }],
            })
        rows.append({"type": "tableRow", "content": cells})

    return {"type": "table", "content": rows}


def _image_to_tiptap(block: ImageBlock) -> dict:
    return {
        "type": "image",
        "attrs": {
            "src": block.src,
            "alt": "",
            "title": "",
        },
    }


def tiptap_to_ir(doc_json: dict, source: str = "") -> DocumentIR:
    """Tiptap JSON → DocumentIR 변환"""
    doc = DocumentIR(
        metadata=DocumentMetadata(title=source, source=source),
    )
    section = doc.sections[0]

    for node in doc_json.get("content", []):
        block = _tiptap_node_to_block(node)
        if block:
            section.blocks.append(block)

    return doc


def _tiptap_node_to_block(node: dict):
    """Tiptap 노드 → IR 블록"""
    node_type = node.get("type", "")

    if node_type == "heading":
        level = node.get("attrs", {}).get("level", 1)
        runs = _tiptap_content_to_runs(node.get("content", []))
        return HeadingBlock(level=level, runs=runs)

    elif node_type == "paragraph":
        runs = _tiptap_content_to_runs(node.get("content", []))
        return ParagraphBlock(runs=runs)

    elif node_type == "mathBlock":
        latex = node.get("attrs", {}).get("latex", "")
        return EquationBlock(latex=latex)

    elif node_type == "table":
        rows = []
        for row_node in node.get("content", []):
            if row_node.get("type") == "tableRow":
                cells = []
                for cell_node in row_node.get("content", []):
                    cell_runs = []
                    for p in cell_node.get("content", []):
                        cell_runs.extend(_tiptap_content_to_runs(p.get("content", [])))
                    cells.append(cell_runs)
                rows.append(TableRow(cells=cells))
        return TableBlock(rows=rows)

    elif node_type == "image":
        src = node.get("attrs", {}).get("src", "")
        return ImageBlock(src=src)

    return None


def _tiptap_content_to_runs(content: list) -> list:
    """Tiptap content array → IR runs"""
    runs = []
    for item in content:
        if item.get("type") == "text":
            text = item.get("text", "")
            marks = item.get("marks", [])
            bold = any(m.get("type") == "bold" for m in marks)
            italic = any(m.get("type") == "italic" for m in marks)
            runs.append(TextRun(content=text, bold=bold, italic=italic))
        elif item.get("type") == "mathInline":
            latex = item.get("attrs", {}).get("latex", "")
            runs.append(InlineEquation(latex=latex))
    return runs
