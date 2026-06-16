"""
문서 중간 표현(IR) 스키마

PDF 추출 결과와 HWPX 생성 엔진 사이의 공통 데이터 모델.
Pydantic v2 기반.
"""

from pydantic import BaseModel, Field
from typing import Union
from enum import Enum


# ── Inline Runs ──

class TextRun(BaseModel):
    type: str = "text"
    content: str = ""
    bold: bool = False
    italic: bool = False


class InlineEquation(BaseModel):
    type: str = "equation_inline"
    latex: str = ""
    id: str = ""


InlineRunType = Union[TextRun, InlineEquation]


# ── Table ──

class TableRow(BaseModel):
    cells: list[list[InlineRunType]] = []


# ── Blocks ──

class ParagraphBlock(BaseModel):
    type: str = "paragraph"
    runs: list[InlineRunType] = []
    align: str = "JUSTIFY"


class HeadingBlock(BaseModel):
    type: str = "heading"
    level: int = 1
    runs: list[InlineRunType] = []


class EquationBlock(BaseModel):
    type: str = "equation_block"
    latex: str = ""
    id: str = ""


class TableBlock(BaseModel):
    type: str = "table"
    rows: list[TableRow] = []
    col_widths: list[int] = []
    is_box: bool = False  # <보기>/<조건> 박스 (1행1열, 실선 테두리)


class ImageBlock(BaseModel):
    type: str = "image"
    src: str = ""
    width: int = 0
    height: int = 0
    bin_id: str = ""  # HWPX BinData 파일명 (예: "image1.png")


BlockType = Union[ParagraphBlock, HeadingBlock, EquationBlock, TableBlock, ImageBlock]


# ── Document ──

class DocumentMetadata(BaseModel):
    title: str = ""
    pageCount: int = 0
    source: str = ""


class Section(BaseModel):
    blocks: list[BlockType] = []


class DocumentIR(BaseModel):
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)
    sections: list[Section] = Field(default_factory=lambda: [Section()])
