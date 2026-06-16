"""IR 모듈 — 문서 중간 표현 스키마"""
from .schema import (
    DocumentIR, DocumentMetadata, Section,
    ParagraphBlock, HeadingBlock, EquationBlock, TableBlock, ImageBlock,
    TextRun, InlineEquation, TableRow,
    BlockType, InlineRunType,
)
