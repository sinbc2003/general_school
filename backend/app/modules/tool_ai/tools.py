"""AI 도우미 도구 schema 정의 (function/tool calling).

도구 자체 실행은 frontend가 수행 (Yjs CRDT 충돌 방지 + 사용자 preview→적용).
backend는 LLM에 도구 schema를 제공하고, LLM이 호출한 tool_use JSON을 그대로
frontend에 반환한다.

도구 카탈로그(`TOOLS_BY_KIND`)는 도구 종류(문서/시트/슬라이드/설문)별로 분리 —
사용자가 문서를 편집 중이면 문서 도구만 노출 (LLM 혼란 방지).
"""

from typing import Any


# JSON Schema 형식 — Anthropic은 input_schema, OpenAI는 parameters로 받음.
# 각 adapter에서 변환.

DOC_TOOLS: list[dict[str, Any]] = [
    {
        "name": "doc_append_markdown",
        "description": "협업 문서 끝에 마크다운 콘텐츠를 추가. 헤딩(#/##/###), 목록(-/1.), 코드 블록(```), 표, 인용(>) 모두 사용 가능.",
        "input_schema": {
            "type": "object",
            "properties": {
                "markdown": {
                    "type": "string",
                    "description": "추가할 마크다운 본문. 멀티라인 OK.",
                },
            },
            "required": ["markdown"],
        },
    },
    {
        "name": "doc_replace_all",
        "description": "협업 문서 본문을 통째로 교체. 신중하게 — 기존 내용은 사라진다. 처음부터 새로 작성할 때만 사용.",
        "input_schema": {
            "type": "object",
            "properties": {
                "markdown": {
                    "type": "string",
                    "description": "전체 본문 마크다운.",
                },
            },
            "required": ["markdown"],
        },
    },
]


SHEET_TOOLS: list[dict[str, Any]] = [
    {
        "name": "sheet_write_cells",
        "description": "스프레드시트의 여러 셀에 값을 쓴다. row/col은 0-indexed (A1 = row 0, col 0).",
        "input_schema": {
            "type": "object",
            "properties": {
                "cells": {
                    "type": "array",
                    "description": "셀 list. 각 셀은 {row, col, value}.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "row": {"type": "integer", "minimum": 0},
                            "col": {"type": "integer", "minimum": 0},
                            "value": {
                                "description": "셀 값. 문자열·숫자·수식(=A1+B1).",
                            },
                        },
                        "required": ["row", "col", "value"],
                    },
                },
            },
            "required": ["cells"],
        },
    },
]


SLIDE_TOOLS: list[dict[str, Any]] = [
    {
        "name": "slide_add",
        "description": "새 슬라이드를 덱 끝에 추가. 제목 + 본문(마크다운).",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "슬라이드 제목 (h1으로 렌더)."},
                "content_markdown": {
                    "type": "string",
                    "description": "본문 마크다운. 빈 문자열 가능.",
                },
            },
            "required": ["title"],
        },
    },
]


SURVEY_TOOLS: list[dict[str, Any]] = [
    {
        "name": "survey_add_question",
        "description": "설문에 질문 1개를 추가. 객관식이면 options 필수.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question_text": {"type": "string", "description": "질문 본문."},
                "question_type": {
                    "type": "string",
                    "enum": ["short_text", "long_text", "single_choice", "multi_choice", "rating", "date"],
                    "description": "질문 유형.",
                },
                "is_required": {"type": "boolean", "default": False},
                "options": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "single_choice/multi_choice 일 때 선택지 list.",
                },
                "rating_max": {
                    "type": "integer",
                    "minimum": 2,
                    "maximum": 10,
                    "description": "rating type일 때 최대 점수 (기본 5).",
                },
            },
            "required": ["question_text", "question_type"],
        },
    },
]


TOOLS_BY_KIND: dict[str, list[dict[str, Any]]] = {
    "doc": DOC_TOOLS,
    "sheet": SHEET_TOOLS,
    "slide": SLIDE_TOOLS,
    "survey": SURVEY_TOOLS,
}


SYSTEM_PROMPT_BY_KIND: dict[str, str] = {
    "doc": (
        "당신은 한국 학교 교사의 협업 문서 작성을 돕는 AI 도우미입니다. "
        "교사가 요청하는 내용을 마크다운으로 작성해 doc_append_markdown 또는 doc_replace_all 도구로 적용합니다. "
        "수업안·평가 루브릭·가정통신문·회의록 등 학교 업무 문서에 특화되어 있습니다. "
        "도구 호출 전 짧게 의도를 한국어로 설명한 뒤 도구를 부르세요."
    ),
    "sheet": (
        "당신은 한국 학교 교사의 스프레드시트 작성을 돕는 AI 도우미입니다. "
        "성적표·출석부·평가 채점 시트 등을 sheet_write_cells 도구로 만듭니다. "
        "row/col은 0-indexed (A1 = {row:0, col:0})입니다. "
        "여러 셀은 한 번의 도구 호출에 모아서 보내세요 (한 번에 100개 정도까지 OK)."
    ),
    "slide": (
        "당신은 한국 학교 교사의 프리젠테이션 작성을 돕는 AI 도우미입니다. "
        "수업 슬라이드·교과 안내·연수 자료 등을 slide_add 도구로 한 장씩 추가합니다. "
        "각 슬라이드는 제목 + 본문 마크다운. 한 번에 여러 슬라이드 추가 가능."
    ),
    "survey": (
        "당신은 한국 학교 교사의 설문지 작성을 돕는 AI 도우미입니다. "
        "수업 평가·진로 조사·교사 만족도 등의 설문을 survey_add_question 도구로 한 문항씩 추가합니다. "
        "객관식이면 options을 반드시 제공하세요."
    ),
}
