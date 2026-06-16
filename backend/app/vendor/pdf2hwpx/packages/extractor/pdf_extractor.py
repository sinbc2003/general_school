#!/usr/bin/env python3
"""
PDF 텍스트/이미지 추출기

PyMuPDF 기반으로 PDF에서 텍스트와 이미지를 추출.
수식 OCR은 별도 모듈(mathpix_client, vlm_client)에서 처리.
"""

import fitz  # PyMuPDF
import os
from pathlib import Path


def extract_text_blocks(pdf_path: str) -> list[dict]:
    """PDF에서 텍스트 블록 추출

    Returns:
        list of {"page": int, "text": str, "bbox": (x0, y0, x1, y1)}
    """
    doc = fitz.open(pdf_path)
    blocks = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_blocks = page.get_text("blocks")

        for block in text_blocks:
            x0, y0, x1, y1, text, block_no, block_type = block
            if block_type == 0 and text.strip():  # 텍스트 블록만
                blocks.append({
                    "page": page_num + 1,
                    "text": text.strip(),
                    "bbox": (x0, y0, x1, y1),
                })

    doc.close()
    return blocks


def extract_images(pdf_path: str, output_dir: str) -> list[dict]:
    """PDF에서 이미지 추출

    Returns:
        list of {"page": int, "image_path": str, "bbox": (x0,y0,x1,y1), "size": (w,h)}
    """
    doc = fitz.open(pdf_path)
    os.makedirs(output_dir, exist_ok=True)
    images = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        image_list = page.get_images(full=True)

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]
            pix = fitz.Pixmap(doc, xref)

            if pix.n > 4:  # CMYK → RGB
                pix = fitz.Pixmap(fitz.csRGB, pix)

            img_name = f"page{page_num+1}_img{img_idx+1}.png"
            img_path = os.path.join(output_dir, img_name)
            pix.save(img_path)

            images.append({
                "page": page_num + 1,
                "image_path": img_path,
                "size": (pix.width, pix.height),
            })
            pix = None

    doc.close()
    return images


def extract_page_as_image(pdf_path: str, page_num: int,
                          output_path: str, dpi: int = 300) -> str:
    """PDF 페이지를 이미지로 렌더링 (수식 OCR용)

    Args:
        page_num: 0-indexed 페이지 번호
        dpi: 해상도

    Returns:
        저장된 이미지 경로
    """
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    pix.save(output_path)
    doc.close()
    return output_path


def crop_pdf(pdf_path: str, output_path: str = None,
             top: float = 0, bottom: float = 0,
             left: float = 0, right: float = 0,
             unit: str = "percent",
             pages: list[int] = None,
             ranges: list[dict] = None) -> str:
    """PDF 페이지 크롭 — cropbox 설정 방식 (벡터/이미지 구조 보존)

    set_cropbox()로 각 페이지의 가시 영역을 제한.
    - PyMuPDF get_pixmap(): cropbox 존중 → 이미지 모드 Mathpix에 크롭 반영
    - PyMuPDF get_text(): cropbox 존중 → 텍스트 추출 시 크롭 반영
    - 개별 이미지 추출: extract_images_from_pdf에서 cropbox 밖 이미지 필터링

    Args:
        pdf_path: 원본 PDF 경로
        output_path: 출력 경로 (None이면 원본 덮어쓰기)
        top/bottom/left/right: 전체 동일 크롭 (percent 또는 pt)
        unit: "percent" (0~100) 또는 "pt" (포인트)
        pages: 크롭할 페이지 목록 (1-indexed, None이면 전체)
        ranges: 범위별 크롭 설정 리스트 (이 값이 있으면 top/bottom/left/right 무시)
                [{"start": 1, "end": 3, "top": 5, "bottom": 4, "left": 3, "right": 3}, ...]

    Returns:
        크롭된 PDF 경로
    """
    doc = fitz.open(pdf_path)

    page_crops: dict[int, dict] = {}

    if ranges:
        for r in ranges:
            s = r.get("start", 1)
            e = r.get("end", len(doc))
            for p in range(s, e + 1):
                page_crops[p] = {
                    "top": r.get("top", 0), "bottom": r.get("bottom", 0),
                    "left": r.get("left", 0), "right": r.get("right", 0),
                }
    else:
        for p in range(1, len(doc) + 1):
            if pages and p not in pages:
                continue
            page_crops[p] = {"top": top, "bottom": bottom, "left": left, "right": right}

    for page_num in range(len(doc)):
        crop_vals = page_crops.get(page_num + 1)
        if not crop_vals or all(v == 0 for v in crop_vals.values()):
            continue

        page = doc[page_num]
        # mediabox 기준으로 크롭 (cropbox가 이미 설정된 경우에도 원본 기준)
        rect = page.mediabox
        w = rect.width
        h = rect.height

        if unit == "percent":
            ct = h * crop_vals["top"] / 100
            cb = h * crop_vals["bottom"] / 100
            cl = w * crop_vals["left"] / 100
            cr = w * crop_vals["right"] / 100
        else:
            ct, cb, cl, cr = crop_vals["top"], crop_vals["bottom"], crop_vals["left"], crop_vals["right"]

        new_rect = fitz.Rect(rect.x0 + cl, rect.y0 + ct, rect.x1 - cr, rect.y1 - cb)
        page.set_cropbox(new_rect)

    if output_path is None:
        output_path = pdf_path

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)

    if output_path == pdf_path:
        tmp_path = output_path + ".tmp"
        doc.save(tmp_path)
        doc.close()
        os.replace(tmp_path, output_path)
    else:
        doc.save(output_path)
        doc.close()

    return output_path


def get_pdf_info(pdf_path: str) -> dict:
    """PDF 기본 정보 반환"""
    doc = fitz.open(pdf_path)
    info = {
        "page_count": len(doc),
        "metadata": doc.metadata,
        "file_size": os.path.getsize(pdf_path),
    }
    doc.close()
    return info
