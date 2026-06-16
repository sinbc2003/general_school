"""PDF 번역 — PyMuPDF로 페이지별 텍스트 추출 + 청크 분할 + 번역 프롬프트.

실제 LLM 호출은 runner.py 가 llm_complete 로 수행 (페이지 단위 진행률 갱신).
"""

LANG_NAMES = {
    "ko": "한국어",
    "en": "영어(English)",
    "ja": "일본어(日本語)",
    "zh": "중국어(中文)",
    "es": "스페인어(Español)",
    "fr": "프랑스어(Français)",
    "de": "독일어(Deutsch)",
    "ru": "러시아어(Русский)",
    "vi": "베트남어(Tiếng Việt)",
}


def extract_pages(pdf_bytes: bytes) -> list[str]:
    """PyMuPDF로 페이지별 텍스트 추출 (동기 — to_thread로 호출)."""
    import fitz  # PyMuPDF  # noqa: PLC0415

    pages: list[str] = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            pages.append(page.get_text("text") or "")
    finally:
        doc.close()
    return pages


def chunk_text(text: str, max_chars: int = 2500) -> list[str]:
    """문단 경계 기준으로 max_chars 이하 청크로 분할 (LLM 토큰/타임아웃 보호).

    max_chars는 보수적으로 2500 — CJK(한국어/일본어/중국어) 번역은 출력 토큰이
    입력 글자 수보다 많을 수 있어, max_tokens(8192) 초과로 잘리지 않게 여유를 둔다.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    chunks: list[str] = []
    buf = ""
    for para in text.split("\n\n"):
        if len(para) > max_chars:
            if buf.strip():
                chunks.append(buf.strip())
                buf = ""
            for line in para.split("\n"):
                if len(buf) + len(line) + 1 > max_chars and buf:
                    chunks.append(buf.strip())
                    buf = ""
                buf += line + "\n"
        else:
            if len(buf) + len(para) + 2 > max_chars and buf:
                chunks.append(buf.strip())
                buf = ""
            buf += para + "\n\n"
    if buf.strip():
        chunks.append(buf.strip())
    return chunks


def lang_label(code: str) -> str:
    return LANG_NAMES.get(code, code)


def build_system_prompt(target_lang: str, source_lang: str | None = None) -> str:
    tgt = lang_label(target_lang)
    src = lang_label(source_lang) if source_lang else None
    src_clause = f"원문 언어는 {src}이다. " if src else ""
    return (
        "당신은 전문 번역가다. "
        f"{src_clause}주어진 텍스트를 자연스럽고 정확한 {tgt}로 번역하라.\n"
        "규칙:\n"
        "- 번역문만 출력한다. 설명·머리말·코드펜스·따옴표를 덧붙이지 않는다.\n"
        "- 문단과 줄바꿈 구조를 최대한 보존한다.\n"
        "- 수식·코드·숫자·고유명사는 보존한다 (의미 없는 음역 금지).\n"
        "- 표는 가능한 한 마크다운 표 형태로 유지한다.\n"
        f"- 이미 {tgt}로 된 부분은 그대로 둔다."
    )
