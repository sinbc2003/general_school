#!/usr/bin/env python3
"""
PDF → HWPX 통합 변환기

다른 플랫폼(CLI, 웹, edu-shin 등)에서 임포트하여 사용하는 메인 진입점.

사용법:
    from packages.core.converter import convert_pdf, ConvertResult

    result = convert_pdf("input.pdf", mode="hybrid", doc_type="exam")
    # result.mmd  — Mathpix Markdown 텍스트
    # result.tiptap_json  — Tiptap 에디터용 JSON
    # result.hwpx_path  — HWPX 파일 경로 (output_path 지정 시)
"""

import os
import sys
import re
import base64
import logging
import tempfile
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# 경로 설정 (이 파일이 packages/core/ 에 위치)
_CORE_DIR = os.path.dirname(os.path.abspath(__file__))
_PACKAGES_DIR = os.path.dirname(_CORE_DIR)
_PROJECT_ROOT = os.path.dirname(_PACKAGES_DIR)

for _p in [
    os.path.join(_CORE_DIR, "equation_converter"),
    os.path.join(_CORE_DIR, "hwpx_generator"),
    os.path.join(_CORE_DIR, "ir"),
    _CORE_DIR,
    os.path.join(_PACKAGES_DIR, "extractor"),
]:
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ── 결과 데이터 클래스 ──

@dataclass
class ConvertResult:
    """변환 결과"""
    mmd: str = ""
    tiptap_json: Optional[dict] = None
    hwpx_path: Optional[str] = None
    total_pages: int = 0
    success_pages: int = 0
    failed_pages: list[int] = field(default_factory=list)
    images_from_pdf: int = 0
    mode: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass
class CropRange:
    """크롭 범위 설정"""
    start: int  # 1-indexed
    end: int    # 1-indexed, inclusive
    top: float = 0
    bottom: float = 0
    left: float = 0
    right: float = 0


@dataclass
class ConvertOptions:
    """변환 옵션"""
    mode: str = "hybrid"          # "hybrid" | "image" | "pdf"
    doc_type: str = "exam"        # "exam" | "general"
    app_id: str = ""              # Mathpix API ID (빈 문자열이면 환경변수 사용)
    app_key: str = ""             # Mathpix API Key
    crop_ranges: list[CropRange] = field(default_factory=list)
    crop_top: float = 0           # 전체 동일 크롭 (crop_ranges 미사용 시)
    crop_bottom: float = 0
    crop_left: float = 0
    crop_right: float = 0
    dpi: int = 300
    max_workers: int = 3
    output_hwpx: Optional[str] = None  # HWPX 출력 경로 (None이면 생성 안 함)


# ── 문항번호 패턴 ──

# Mathpix 변형 대응: "1. ", "1.문", "**1.** ", "1) " 등
_Q_PATTERN_MMD = re.compile(r'^\*{0,2}(\d{1,2})[\.\)]\*{0,2}\s*(?=\S)')
_Q_NUM_PATS = [
    re.compile(r'^\*{0,2}(\d{1,2})\.\*{0,2}$'),
    re.compile(r'^(\d{1,2})\)$'),
]


# ── 메인 변환 함수 ──

def convert_pdf(pdf_path: str, options: ConvertOptions = None, **kwargs) -> ConvertResult:
    """PDF → MMD + Tiptap JSON + HWPX 변환.

    Args:
        pdf_path: 입력 PDF 경로
        options: 변환 옵션 (ConvertOptions). kwargs로도 개별 지정 가능.

    Returns:
        ConvertResult

    사용 예:
        # 옵션 객체로
        result = convert_pdf("test.pdf", ConvertOptions(mode="hybrid", doc_type="exam"))

        # kwargs로 간단하게
        result = convert_pdf("test.pdf", mode="hybrid", doc_type="exam")
    """
    if options is None:
        options = ConvertOptions(**kwargs)

    # 크롭 적용
    work_pdf = _apply_crop(pdf_path, options)

    # 모드별 변환
    if options.mode == "hybrid":
        result = _convert_hybrid(work_pdf, options)
    elif options.mode == "image":
        result = _convert_image_mode(work_pdf, options)
    else:
        result = _convert_pdf_mode(work_pdf, options)

    # 모의고사 문항 정렬
    if options.doc_type == "exam" and result.mmd:
        from mmd_parser import reorder_exam_questions
        result.mmd = reorder_exam_questions(result.mmd)

    # 한국 수학 문서 후처리 (띄어쓰기, 수학 기호 보정)
    if result.mmd:
        from postprocess import postprocess_mmd
        result.mmd = postprocess_mmd(result.mmd)

    # 문항번호 누락 감지
    if options.doc_type == "exam" and result.mmd:
        missing = _detect_missing_questions(result.mmd)
        if missing:
            result.warnings.append(f"누락 문항: {', '.join(str(n) for n in missing)}")
            logger.warning(f"문항번호 누락 감지: {missing}")

    # Tiptap JSON 변환
    if result.mmd:
        from mmd_parser import parse_mmd
        from tiptap_bridge import ir_to_tiptap
        doc_ir = parse_mmd(result.mmd, source=os.path.basename(pdf_path))
        result.tiptap_json = ir_to_tiptap(doc_ir)

        # 이미지 URL → data URI
        _resolve_images_in_tiptap(result.tiptap_json)

    # HWPX 출력
    if options.output_hwpx and result.mmd:
        from mmd_parser import parse_mmd
        from pipeline import ir_to_hwpx
        doc_ir = parse_mmd(result.mmd, source=os.path.basename(pdf_path))
        result.hwpx_path = ir_to_hwpx(doc_ir, options.output_hwpx)

    return result


# ── 문항번호 누락 감지 ──

def _detect_missing_questions(mmd: str) -> list[int]:
    """MMD에서 문항번호를 추출하고 빠진 번호를 반환."""
    found = set()
    for line in mmd.split('\n'):
        m = _Q_PATTERN_MMD.match(line.strip())
        if m:
            found.add(int(m.group(1)))
    if not found:
        return []
    max_q = max(found)
    missing = [n for n in range(1, max_q + 1) if n not in found]
    return missing


def _map_questions_to_pages(mmd: str) -> dict[int, int]:
    """MMD에서 문항번호 → 페이지 번호(0-based) 매핑.
    페이지 구분자 '\\n\\n---\\n\\n' 기준."""
    pages = mmd.split('\n\n---\n\n')
    q_to_page: dict[int, int] = {}
    for page_idx, page_text in enumerate(pages):
        for line in page_text.split('\n'):
            m = _Q_PATTERN_MMD.match(line.strip())
            if m:
                q_to_page[int(m.group(1))] = page_idx
    return q_to_page


# ── 크롭 ──

def _apply_crop(pdf_path: str, options: ConvertOptions) -> str:
    """크롭 적용. 원본 변경 없이 복사본 반환."""
    has_ranges = bool(options.crop_ranges)
    has_single = any(v > 0 for v in [
        options.crop_top, options.crop_bottom, options.crop_left, options.crop_right
    ])

    if not has_ranges and not has_single:
        return pdf_path

    from pdf_extractor import crop_pdf

    output_dir = tempfile.mkdtemp()
    cropped = os.path.join(output_dir, "cropped.pdf")

    if has_ranges:
        ranges = [
            {"start": r.start, "end": r.end,
             "top": r.top, "bottom": r.bottom,
             "left": r.left, "right": r.right}
            for r in options.crop_ranges
        ]
        crop_pdf(pdf_path, cropped, unit="percent", ranges=ranges)
        logger.info(f"범위별 크롭: {len(ranges)}개 범위")
    else:
        crop_pdf(pdf_path, cropped,
                 top=options.crop_top, bottom=options.crop_bottom,
                 left=options.crop_left, right=options.crop_right,
                 unit="percent")
        logger.info(f"단일 크롭: {options.crop_top}/{options.crop_bottom}/{options.crop_left}/{options.crop_right}")

    return cropped


# ── 하이브리드 모드 ──

def _convert_hybrid(pdf_path: str, options: ConvertOptions) -> ConvertResult:
    """하이브리드 모드: PDF 모드(이미지 위치 정확) 기반 + 직접 이미지 교체.

    Mathpix PDF 모드 MMD는 이미지를 정확한 위치에 배치하므로,
    이를 기반으로 사용하고 Mathpix CDN 이미지를 PDF에서 직접 추출한 고화질 이미지로 교체.
    """
    from mathpix_client import pdf_to_mmd, pdf_to_mmd_by_pages, extract_images_from_pdf
    import fitz

    output_dir = tempfile.mkdtemp()
    api_kw = {"app_id": options.app_id or None, "app_key": options.app_key or None}

    # 1. PDF 모드 (이미지 위치 정확) — 메인
    pdf_mmd = None
    try:
        pdf_output_dir = os.path.join(output_dir, "_pdf_mode")
        os.makedirs(pdf_output_dir, exist_ok=True)
        pdf_mmd_path = pdf_to_mmd(pdf_path, pdf_output_dir, **api_kw)
        with open(pdf_mmd_path, 'r', encoding='utf-8') as f:
            pdf_mmd = f.read()
        logger.info(f"PDF 모드 완료: {len(pdf_mmd)}자")
    except Exception as e:
        logger.warning(f"PDF 모드 실패: {e}")

    # 2. 이미지 모드 (텍스트/수식 품질 우수) — 폴백 또는 텍스트 보완용
    img_result = pdf_to_mmd_by_pages(
        pdf_path, output_dir, dpi=options.dpi,
        max_workers=options.max_workers, **api_kw,
    )
    with open(img_result["mmd_path"], 'r', encoding='utf-8') as f:
        img_mmd = f.read()

    # 3. 메인 MMD 선택: PDF 모드가 있으면 사용, 없으면 이미지 모드
    if pdf_mmd:
        main_mmd = pdf_mmd
        logger.info("PDF 모드 MMD 사용 (이미지 위치 정확)")
    else:
        main_mmd = img_mmd
        logger.info("이미지 모드 MMD 사용 (PDF 모드 실패)")

    # 4. 이미지 처리
    # PDF 모드 MMD에는 Mathpix CDN URL이 정확한 위치에 있음.
    # CDN URL은 _resolve_images_in_tiptap에서 data URI로 자동 변환되므로 교체 불필요.
    # 직접 추출 이미지 개수만 카운트.
    images_count = 0
    try:
        direct_images = extract_images_from_pdf(pdf_path)
        images_count = len(direct_images) if direct_images else 0
    except Exception:
        pass

    result = ConvertResult(
        mmd=main_mmd,
        total_pages=img_result["total_pages"],
        success_pages=img_result["success_pages"],
        failed_pages=img_result.get("failed_pages", []),
        images_from_pdf=images_count,
        mode="hybrid",
    )
    if img_result.get("failed_pages"):
        result.warnings.append(f"실패 페이지: {img_result['failed_pages']}")

    return result


# ── 이미지 모드 ──

def _convert_image_mode(pdf_path: str, options: ConvertOptions) -> ConvertResult:
    from mathpix_client import pdf_to_mmd_by_pages
    output_dir = tempfile.mkdtemp()

    result_data = pdf_to_mmd_by_pages(
        pdf_path, output_dir,
        app_id=options.app_id or None, app_key=options.app_key or None,
        dpi=options.dpi, max_workers=options.max_workers,
    )
    with open(result_data["mmd_path"], 'r', encoding='utf-8') as f:
        mmd_text = f.read()

    return ConvertResult(
        mmd=mmd_text,
        total_pages=result_data["total_pages"],
        success_pages=result_data["success_pages"],
        failed_pages=result_data.get("failed_pages", []),
        mode="image",
    )


# ── PDF 모드 ──

def _convert_pdf_mode(pdf_path: str, options: ConvertOptions) -> ConvertResult:
    from mathpix_client import pdf_to_mmd
    output_dir = tempfile.mkdtemp()

    mmd_path = pdf_to_mmd(
        pdf_path, output_dir,
        app_id=options.app_id or None, app_key=options.app_key or None,
    )
    with open(mmd_path, 'r', encoding='utf-8') as f:
        mmd_text = f.read()

    return ConvertResult(mmd=mmd_text, mode="pdf")


# ── CDN 이미지 → 직접추출 이미지 교체 ──

def _replace_cdn_images_with_direct(
    mmd: str, direct_images: list[dict], pdf_path: str,
) -> str:
    """MMD 내 Mathpix CDN 이미지 URL을 PDF에서 직접 추출한 고화질 이미지로 교체.

    PDF 모드 MMD에는 ![](https://cdn.mathpix.com/...) 형태의 이미지 참조가 있음.
    이를 직접 추출한 base64 data URI로 교체.
    페이지+순서로 매칭 (같은 페이지의 n번째 CDN 이미지 = n번째 직접 추출 이미지).
    """
    import fitz

    # MMD를 페이지별로 분리
    img_ref_pattern = re.compile(r'!\[([^\]]*)\]\((https?://[^)]+)\)')

    # 직접 추출 이미지를 페이지별로 그룹화 (y좌표 순서)
    by_page: dict[int, list] = {}
    for dimg in direct_images:
        by_page.setdefault(dimg["page"], []).append(dimg)
    for page_imgs in by_page.values():
        page_imgs.sort(key=lambda d: d["y_position"])

    # MMD에서 CDN 이미지 참조를 찾아 교체
    # 페이지 구분자(---)로 분리된 경우 페이지 매핑 가능
    pages = mmd.split('\n\n---\n\n')
    replaced_count = 0

    for page_idx, page_text in enumerate(pages):
        page_num = page_idx + 1
        page_direct = by_page.get(page_num, [])

        if not page_direct:
            continue

        # 이 페이지의 CDN 이미지 참조 찾기
        cdn_refs = list(img_ref_pattern.finditer(page_text))
        if not cdn_refs:
            continue

        # 순서대로 매칭 (CDN n번째 = 직접추출 n번째)
        new_page = page_text
        offset_adj = 0  # 문자열 교체로 인한 오프셋

        for i, match in enumerate(cdn_refs):
            if i >= len(page_direct):
                break

            dimg = page_direct[i]
            b64 = base64.b64encode(dimg["data"]).decode()
            data_uri = f"data:image/png;base64,{b64}"
            old_url = match.group(2)
            alt = match.group(1)

            old_text = match.group(0)
            new_text = f"![{alt}]({data_uri})"

            # 위치 기반 교체 (오프셋 조정)
            start = match.start() + offset_adj
            end = match.end() + offset_adj
            new_page = new_page[:start] + new_text + new_page[end:]
            offset_adj += len(new_text) - len(old_text)
            replaced_count += 1

        pages[page_idx] = new_page

    logger.info(f"CDN→직접추출 교체: {replaced_count}개 이미지")

    # 페이지 구분자가 없는 경우 (전체 한 덩어리)
    if len(pages) == 1 and replaced_count == 0:
        # 전체 MMD에서 순서대로 교체
        all_direct = sorted(direct_images, key=lambda d: (d["page"], d["y_position"]))
        cdn_refs = list(img_ref_pattern.finditer(mmd))
        if cdn_refs and all_direct:
            new_mmd = mmd
            offset_adj = 0
            for i, match in enumerate(cdn_refs):
                if i >= len(all_direct):
                    break
                dimg = all_direct[i]
                b64 = base64.b64encode(dimg["data"]).decode()
                data_uri = f"data:image/png;base64,{b64}"
                old_text = match.group(0)
                new_text = f"![{match.group(1)}]({data_uri})"
                start = match.start() + offset_adj
                end = match.end() + offset_adj
                new_mmd = new_mmd[:start] + new_text + new_mmd[end:]
                offset_adj += len(new_text) - len(old_text)
            return new_mmd

    return '\n\n---\n\n'.join(pages)


# ── 이미지 매칭 + 삽입 (이미지 모드 폴백용) ──

def _match_and_insert_images(
    img_mmd: str,
    direct_images: list[dict],
    pdf_path: str,
    pdf_mode_mmd: str | None = None,
) -> str:
    """PDF에서 추출한 이미지를 MMD 텍스트의 정확한 위치에 삽입."""
    import fitz

    q_pattern = re.compile(r'^(\d{1,2})[\.\)]\s')

    # 문항번호 span 위치 추출
    doc = fitz.open(pdf_path)
    q_locations = []
    for pg_idx in range(len(doc)):
        page = doc[pg_idx]
        blocks = page.get_text("dict")["blocks"]
        for blk in blocks:
            if blk["type"] != 0:
                continue
            for ln in blk.get("lines", []):
                for sp in ln.get("spans", []):
                    txt = sp["text"].strip()
                    for pat in _Q_NUM_PATS:
                        qm = pat.match(txt)
                        if qm:
                            q_locations.append({
                                "page": pg_idx + 1,
                                "num": int(qm.group(1)),
                                "bbox": sp["bbox"],
                            })
                            break
    doc.close()
    logger.info(f"문항번호 {len(q_locations)}개 감지")

    # 이미지 → 문항 매칭
    img_to_question: dict[int, list] = {}
    unmatched = []

    for dimg in direct_images:
        b64 = base64.b64encode(dimg["data"]).decode()
        img_md = f'![](data:image/png;base64,{b64})'
        img_page = dimg["page"]
        img_y = dimg["bbox"][1]
        img_x_center = (dimg["bbox"][0] + dimg["bbox"][2]) / 2

        candidates = [q for q in q_locations if q["page"] == img_page and q["bbox"][1] <= img_y]

        if candidates:
            same_col = [q for q in candidates if abs((q["bbox"][0] + q["bbox"][2]) / 2 - img_x_center) < 200]
            best = max(same_col or candidates, key=lambda q: q["bbox"][1])
            img_to_question.setdefault(best["num"], []).append(img_md)
        else:
            unmatched.append({
                "md": img_md, "page": img_page,
                "y_position": dimg["y_position"], "x_center": img_x_center,
            })

    matched_count = sum(len(v) for v in img_to_question.values())
    logger.info(f"이미지 매칭: {matched_count}개 성공, {len(unmatched)}개 미매칭")

    # 매칭된 이미지 삽입
    if img_to_question or unmatched:
        result_lines = []
        current_q = -1
        for line in img_mmd.split('\n'):
            qm = q_pattern.match(line.strip())
            if qm:
                new_q = int(qm.group(1))
                if current_q > 0 and current_q in img_to_question:
                    for im in img_to_question.pop(current_q):
                        result_lines.append('')
                        result_lines.append(im)
                current_q = new_q
            result_lines.append(line)

        if current_q > 0 and current_q in img_to_question:
            for im in img_to_question.pop(current_q):
                result_lines.append('')
                result_lines.append(im)

        for imgs in img_to_question.values():
            for im in imgs:
                result_lines.append('')
                result_lines.append(im)

        img_mmd = '\n'.join(result_lines)

    # 미매칭 이미지 스마트 삽입
    if unmatched:
        img_mmd = _insert_unmatched_images(img_mmd, unmatched, pdf_path, pdf_mode_mmd)

    return img_mmd


# ── 그림 참조 문구 패턴 ──

_FIGURE_REF_PATTERNS = [
    re.compile(r'다음\s*그림과?\s*같[다으]', re.IGNORECASE),
    re.compile(r'그래프는?\s*다음과?\s*같[다으]', re.IGNORECASE),
    re.compile(r'아래\s*그림', re.IGNORECASE),
    re.compile(r'다음\s*그림', re.IGNORECASE),
    re.compile(r'그림과\s*같이', re.IGNORECASE),
    re.compile(r'나타내면\s*다음과?\s*같', re.IGNORECASE),
    re.compile(r'그래프를?\s*그리면', re.IGNORECASE),
    re.compile(r'그래프가?\s*다음', re.IGNORECASE),
    re.compile(r'표는?\s*다음과?\s*같', re.IGNORECASE),
    re.compile(r'다음과\s*같이\s*나타', re.IGNORECASE),
    re.compile(r'\[그림\]', re.IGNORECASE),
]


# ── 미매칭 이미지 스마트 삽입 ──

def _insert_unmatched_images(
    img_mmd: str, unmatched: list[dict],
    pdf_path: str, pdf_mode_mmd: str | None = None,
) -> str:
    """미매칭 이미지를 4단계 전략으로 MMD에 삽입.

    전략 우선순위:
    1. 그림 참조 문구 매칭 ("다음 그림과 같다" 등)
    2. PDF 모드 컨텍스트 (주변 텍스트 매칭)
    3. 문항번호 앵커
    4. 텍스트 밀도 기반 폴백
    """
    import fitz

    if not unmatched:
        return img_mmd

    doc = fitz.open(pdf_path)
    page_width = doc[0].rect.width if len(doc) > 0 else 595
    col_threshold = page_width * 0.5

    pdf_mode_contexts = []
    if pdf_mode_mmd:
        pdf_mode_contexts = _extract_image_contexts(pdf_mode_mmd)

    by_page: dict[int, list] = {}
    for uimg in unmatched:
        by_page.setdefault(uimg["page"], []).append(uimg)

    pages = img_mmd.split('\n\n---\n\n')

    for page_num, page_imgs in by_page.items():
        page_idx = page_num - 1
        if page_idx >= len(pages):
            continue

        page_lines = pages[page_idx].split('\n')
        page_imgs.sort(key=lambda u: (u["x_center"] > col_threshold, u["y_position"]))

        # 그림 참조 문구 위치 추출 (사용되면 제거)
        fig_refs = _find_figure_references(page_lines)
        logger.debug(f"p{page_num}: 그림참조 {len(fig_refs)}개, 이미지 {len(page_imgs)}개")

        q_anchors = []
        for li, line in enumerate(page_lines):
            m = _Q_PATTERN_MMD.match(line.strip())
            if m:
                q_anchors.append((li, int(m.group(1))))

        offset = 0

        for uimg in page_imgs:
            inserted = False

            # ★ 전략 1: 그림 참조 문구 ("다음 그림과 같다" 직후)
            if fig_refs and not inserted:
                idx = _match_by_figure_ref(uimg, page_lines, fig_refs, q_anchors, offset)
                if idx is not None:
                    idx = min(idx, len(page_lines))
                    safe = _find_safe_insert(page_lines, idx)
                    safe = min(safe, len(page_lines))
                    page_lines.insert(safe, '')
                    page_lines.insert(safe + 1, uimg["md"])
                    offset += 2
                    inserted = True
                    # 사용된 참조 제거
                    fig_refs = [(li + 2 if li >= safe else li) for li in fig_refs if li != idx - offset + 2]
                    q_anchors = [(li + 2 if li >= safe else li, qn) for li, qn in q_anchors]
                    logger.info(f"p{page_num} 이미지 → 그림참조 매칭 line {safe}")

            # 전략 2: PDF 모드 컨텍스트
            if pdf_mode_contexts and not inserted:
                idx = _match_by_context(uimg, page_lines, pdf_mode_contexts)
                if idx is not None:
                    idx = min(idx + offset, len(page_lines))
                    safe = _find_safe_insert(page_lines, idx)
                    safe = min(safe, len(page_lines))
                    page_lines.insert(safe, '')
                    page_lines.insert(safe + 1, uimg["md"])
                    offset += 2
                    inserted = True
                    q_anchors = [(li + 2 if li >= safe else li, qn) for li, qn in q_anchors]

            # 전략 3: 문항번호 앵커
            if q_anchors and not inserted:
                idx = _match_by_anchor(uimg, page_lines, q_anchors, col_threshold)
                if idx is not None:
                    idx = min(idx, len(page_lines))
                    safe = _find_safe_insert(page_lines, idx)
                    safe = min(safe, len(page_lines))
                    page_lines.insert(safe, '')
                    page_lines.insert(safe + 1, uimg["md"])
                    offset += 2
                    inserted = True
                    q_anchors = [(li + 2 if li >= safe else li, qn) for li, qn in q_anchors]

            # 전략 4: 텍스트 밀도 기반
            if not inserted:
                idx = _match_by_density(uimg, page_lines)
                idx = min(idx, len(page_lines))
                safe = _find_safe_insert(page_lines, idx)
                safe = min(safe, len(page_lines))
                page_lines.insert(safe, '')
                page_lines.insert(safe + 1, uimg["md"])
                offset += 2

        pages[page_idx] = '\n'.join(page_lines)

    doc.close()
    logger.info(f"미매칭 이미지 {len(unmatched)}개 스마트 삽입 완료")
    return '\n\n---\n\n'.join(pages)


def _find_figure_references(lines: list[str]) -> list[int]:
    """MMD 텍스트에서 그림 참조 문구("다음 그림과 같다" 등)의 라인 인덱스 목록 반환."""
    refs = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        for pat in _FIGURE_REF_PATTERNS:
            if pat.search(stripped):
                refs.append(i)
                break
    return refs


def _match_by_figure_ref(
    uimg: dict, page_lines: list[str],
    fig_refs: list[int], q_anchors: list[tuple[int, int]],
    offset: int,
) -> int | None:
    """그림 참조 문구 중 이 이미지에 가장 적합한 것을 찾아 삽입 위치 반환.

    같은 문항 내의 가장 가까운 참조를 우선 선택.
    """
    if not fig_refs:
        return None

    y_pos = uimg["y_position"]
    total_lines = len(page_lines)

    if total_lines == 0:
        return None

    # 이미지의 예상 라인 위치 (대략적 추정)
    est_line = int(y_pos * total_lines)

    # 이미지보다 위에 있는(또는 근처의) 그림 참조 중 가장 가까운 것
    best_ref = None
    best_dist = float('inf')

    for ref_line in fig_refs:
        # 참조 문구는 이미지보다 위에 있어야 함 (약간의 여유)
        if ref_line <= est_line + 5:
            dist = abs(ref_line - est_line)
            if dist < best_dist:
                best_dist = dist
                best_ref = ref_line

    if best_ref is None:
        return None

    # 참조 문구 바로 다음 줄에 삽입
    # 수식 블록($$ ... $$)이 참조 문구 뒤에 있을 수 있으므로 건너뛰기
    insert_at = best_ref + 1 + offset
    while insert_at < len(page_lines):
        stripped = page_lines[insert_at].strip()
        if stripped.startswith('$$') or stripped.startswith('\\begin{'):
            # 수식 블록 끝까지 스킵
            insert_at += 1
            while insert_at < len(page_lines):
                s2 = page_lines[insert_at].strip()
                if s2.endswith('$$') or s2.startswith('\\end{'):
                    insert_at += 1
                    break
                insert_at += 1
        else:
            break

    return insert_at


def _find_safe_insert(lines: list[str], target_idx: int) -> int:
    in_block = False
    safe_positions = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('$$'):
            in_block = not in_block
        elif stripped.startswith('\\begin{'):
            in_block = True
        elif stripped.startswith('\\end{'):
            in_block = False
            safe_positions.append(i + 1)
        elif not in_block and (stripped == '' or stripped == '---'):
            safe_positions.append(i)
    if not safe_positions:
        return target_idx
    return min(safe_positions, key=lambda p: abs(p - target_idx))


def _extract_image_contexts(pdf_mmd: str) -> list[dict]:
    """PDF 모드 MMD에서 각 이미지의 주변 텍스트(before/after 전체 줄) 추출."""
    contexts = []
    lines = pdf_mmd.split('\n')
    img_pat = re.compile(r'!\[([^\]]*)\]\(([^)]+)\)')

    for i, line in enumerate(lines):
        if img_pat.search(line.strip()):
            # 이미지 전후 텍스트 줄 (수식/이미지 제외, 내용 있는 줄만)
            before = []
            for j in range(i - 1, max(0, i - 10) - 1, -1):
                s = lines[j].strip()
                if s and not img_pat.search(s) and not s.startswith('$$'):
                    before.insert(0, s)
                    if len(before) >= 5:
                        break
            after = []
            for j in range(i + 1, min(len(lines), i + 10)):
                s = lines[j].strip()
                if s and not img_pat.search(s) and not s.startswith('$$'):
                    after.append(s)
                    if len(after) >= 5:
                        break

            q_num = None
            for j in range(i, max(0, i - 30), -1):
                m = _Q_PATTERN_MMD.match(lines[j].strip())
                if m:
                    q_num = int(m.group(1))
                    break

            contexts.append({
                "before": before,
                "after": after,
                "q_num": q_num,
                "position_ratio": i / max(len(lines), 1),
                "used": False,
            })
    return contexts


def _normalize_for_match(text: str) -> str:
    """매칭용 텍스트 정규화 — 공백/특수문자 제거."""
    return re.sub(r'[\s\\${}()\[\]]+', '', text).lower()


def _match_by_context(uimg, page_lines, contexts) -> int | None:
    """PDF 모드 MMD의 이미지 컨텍스트로 삽입 위치를 찾는다.

    1차: 주변 텍스트를 image mode MMD에서 직접 검색 (가장 정확)
    2차: 문항번호 기반 매칭
    """
    y_pos = uimg["y_position"]

    # 위치가 비슷하고 아직 사용 안 된 컨텍스트 중 최적 선택
    candidates = [(c, abs(c["position_ratio"] - y_pos))
                  for c in contexts if not c.get("used")]
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[1])
    # 상위 3개 후보 시도
    for best_ctx, dist in candidates[:3]:
        if dist > 0.25:
            break

        # ★ 1차: before 텍스트 줄을 image mode MMD에서 직접 검색
        # 가장 마지막 줄(이미지 직전)부터 역순으로 시도
        for ctx_line in reversed(best_ctx["before"]):
            if len(ctx_line) < 6:
                continue
            # 정규화 매칭 (공백/수식 기호 차이 무시)
            norm_ctx = _normalize_for_match(ctx_line)
            if len(norm_ctx) < 4:
                continue

            for li, line in enumerate(page_lines):
                norm_line = _normalize_for_match(line)
                # 부분 매칭: 컨텍스트의 핵심 부분이 포함되는지
                if len(norm_ctx) >= 8 and norm_ctx[:20] in norm_line:
                    best_ctx["used"] = True
                    logger.info(f"컨텍스트 텍스트 매칭: \"{ctx_line[:40]}\" → line {li}")
                    return li + 1
                # 정규식 매칭 (원본 텍스트의 앞부분)
                try:
                    escaped = re.escape(ctx_line[:40].strip())
                    if escaped and re.search(escaped, line):
                        best_ctx["used"] = True
                        return li + 1
                except re.error:
                    pass

        # ★ 2차: after 텍스트도 시도 (이미지 다음 줄)
        for ctx_line in best_ctx["after"][:2]:
            if len(ctx_line) < 6:
                continue
            for li, line in enumerate(page_lines):
                try:
                    escaped = re.escape(ctx_line[:40].strip())
                    if escaped and re.search(escaped, line):
                        best_ctx["used"] = True
                        return max(0, li)  # 이 줄 앞에 삽입
                except re.error:
                    pass

        # ★ 3차: 문항번호 기반
        if best_ctx["q_num"] is not None:
            q_line = next_q_line = None
            for li, line in enumerate(page_lines):
                m = _Q_PATTERN_MMD.match(line.strip())
                if m:
                    qn = int(m.group(1))
                    if qn == best_ctx["q_num"]:
                        q_line = li
                    elif q_line is not None and next_q_line is None:
                        next_q_line = li
                        break
            if q_line is not None:
                best_ctx["used"] = True
                # 문항 내에서 y_position 비율로 세부 위치 결정
                end_line = next_q_line - 1 if next_q_line else len(page_lines) - 1
                # 이미지는 보통 문항 중반~후반
                target = q_line + int((end_line - q_line) * 0.5)
                return target

    return None


def _match_by_anchor(uimg, page_lines, q_anchors, col_threshold) -> int | None:
    if not q_anchors:
        return None
    y_pos = uimg["y_position"]
    is_right = uimg["x_center"] > col_threshold
    n_q = len(q_anchors)

    if n_q >= 5:
        half = n_q // 2
        start, end = (half, n_q) if is_right else (0, half)
        q_idx = start + min(int(y_pos * (end - start)), end - start - 1)
    else:
        q_idx = min(int(y_pos * n_q), n_q - 1)

    q_idx = max(0, min(q_idx, n_q - 1))
    target = q_anchors[q_idx][0]
    end_line = q_anchors[q_idx + 1][0] - 1 if q_idx + 1 < n_q else len(page_lines) - 1
    return max(target + 1, target + int((end_line - target) * 0.7))


def _match_by_density(uimg, page_lines) -> int:
    y_pos = uimg["y_position"]
    total = len(page_lines)
    if total == 0:
        return 0

    weights = []
    in_eq = False
    for line in page_lines:
        s = line.strip()
        if s.startswith('$$'):
            in_eq = not in_eq
            weights.append(0.5)
        elif in_eq:
            weights.append(1.5)
        elif s == '':
            weights.append(0.3)
        elif s.startswith('|'):
            weights.append(1.2)
        else:
            weights.append(1.0)

    total_w = sum(weights)
    if total_w == 0:
        return max(1, int(total * y_pos))

    target = y_pos * total_w
    cum = 0
    for i, w in enumerate(weights):
        cum += w
        if cum >= target:
            return i
    return total


# ── Tiptap 이미지 해결 ──

def _resolve_images_in_tiptap(tiptap_json: dict):
    """Tiptap JSON 내 이미지 URL → data URI 변환."""
    from mathpix_client import download_image

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "image":
                src = node.get("attrs", {}).get("src", "")
                if src.startswith("http://") or src.startswith("https://"):
                    try:
                        img_data, filename = download_image(src)
                        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'png'
                        mime = {'png': 'image/png', 'jpg': 'image/jpeg',
                                'jpeg': 'image/jpeg', 'gif': 'image/gif'}.get(ext, 'image/png')
                        b64 = base64.b64encode(img_data).decode()
                        node["attrs"]["src"] = f"data:{mime};base64,{b64}"
                    except Exception as e:
                        logger.warning(f"이미지 다운로드 실패: {src[:60]}... — {e}")
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(tiptap_json)
