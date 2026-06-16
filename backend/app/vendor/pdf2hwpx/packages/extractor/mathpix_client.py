#!/usr/bin/env python3
"""
Mathpix API 클라이언트

PDF/이미지에서 수학 수식을 LaTeX로 추출.
API 키는 파라미터 또는 환경변수 MATHPIX_APP_ID, MATHPIX_APP_KEY 로 설정.

지원 모드:
  1. PDF 모드: PDF 통째로 Mathpix /v3/pdf 엔드포인트 전송 (빠름, 저렴)
  2. 이미지 모드: PDF를 페이지별 고해상도 PNG로 렌더링 후 /v3/text 전송 (한글 인식 우수)
"""

import os
import io
import json
import base64
import time
import logging
import requests
import concurrent.futures
from pathlib import Path

logger = logging.getLogger(__name__)

MATHPIX_API_URL = "https://api.mathpix.com/v3"

# 이미지 모드 기본 설정
DEFAULT_DPI = 300
MAX_RETRIES = 2
PAGE_TIMEOUT = 60
PDF_TIMEOUT = 60
POLL_INTERVAL = 5
MAX_POLL_COUNT = 60  # 최대 5분


def _get_headers(app_id: str = None, app_key: str = None) -> dict:
    """API 헤더 생성. 파라미터 우선, 없으면 환경변수 사용."""
    aid = app_id or os.environ.get("MATHPIX_APP_ID", "")
    akey = app_key or os.environ.get("MATHPIX_APP_KEY", "")
    if not aid or not akey:
        raise ValueError(
            "MATHPIX_APP_ID, MATHPIX_APP_KEY가 필요합니다.\n"
            "https://accounts.mathpix.com 에서 API 키를 발급받을 수 있습니다."
        )
    return {
        "app_id": aid,
        "app_key": akey,
        "Content-type": "application/json",
    }


# ── 이미지 → LaTeX (단일 이미지) ──

def image_to_latex(image_path: str, app_id: str = None, app_key: str = None) -> dict:
    """이미지에서 수식 추출

    Returns:
        {"latex": str, "latex_confidence": float, "text": str}
    """
    headers = _get_headers(app_id, app_key)

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()

    ext = Path(image_path).suffix.lower().lstrip('.')
    mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else 'image/png'

    payload = {
        "src": f"data:{mime};base64,{image_data}",
        "formats": ["latex_styled", "text"],
        "math_inline_delimiters": ["$", "$"],
        "math_display_delimiters": ["$$", "$$"],
    }

    response = requests.post(
        f"{MATHPIX_API_URL}/text",
        headers=headers,
        json=payload,
        timeout=PAGE_TIMEOUT,
    )
    response.raise_for_status()
    result = response.json()

    return {
        "latex": result.get("latex_styled", ""),
        "latex_confidence": result.get("latex_confidence", 0.0),
        "text": result.get("text", ""),
    }


def image_bytes_to_mmd(image_bytes: bytes, app_id: str = None, app_key: str = None,
                       mime: str = "image/png") -> str:
    """이미지 바이트 → Mathpix Markdown 텍스트 반환"""
    headers = _get_headers(app_id, app_key)

    b64 = base64.b64encode(image_bytes).decode()
    payload = {
        "src": f"data:{mime};base64,{b64}",
        "formats": ["text"],
        "math_inline_delimiters": ["$", "$"],
        "math_display_delimiters": ["$$", "$$"],
        "include_line_data": False,
        "enable_tables_fallback": True,
    }

    response = requests.post(
        f"{MATHPIX_API_URL}/text",
        headers=headers,
        json=payload,
        timeout=PAGE_TIMEOUT,
    )
    response.raise_for_status()
    result = response.json()
    return result.get("text", "")


# ── PDF → MMD (PDF 모드: 통째로) ──

def pdf_to_mmd(pdf_path: str, output_dir: str = None,
               app_id: str = None, app_key: str = None) -> str:
    """PDF → Mathpix Markdown (.mmd) 변환 (PDF 모드)

    Mathpix PDF Processing API 사용. 전체 PDF를 한 번에 전송.

    Returns:
        .mmd 파일 경로
    """
    headers = _get_headers(app_id, app_key)
    upload_headers = {
        "app_id": headers["app_id"],
        "app_key": headers["app_key"],
    }

    # 1. PDF 업로드
    with open(pdf_path, "rb") as f:
        response = requests.post(
            f"{MATHPIX_API_URL}/pdf",
            headers=upload_headers,
            files={"file": (os.path.basename(pdf_path), f, "application/pdf")},
            data={
                "options_json": json.dumps({
                    "conversion_formats": {"md": True},
                    "math_inline_delimiters": ["$", "$"],
                    "math_display_delimiters": ["$$", "$$"],
                    "include_image_data": True,
                    "enable_tables_fallback": True,
                })
            },
            timeout=PDF_TIMEOUT,
        )
    response.raise_for_status()
    pdf_id = response.json().get("pdf_id")

    if not pdf_id:
        raise ValueError(f"PDF 업로드 실패: {response.json()}")

    # 2. 변환 완료 대기
    for _ in range(MAX_POLL_COUNT):
        status_resp = requests.get(
            f"{MATHPIX_API_URL}/pdf/{pdf_id}",
            headers=upload_headers,
            timeout=10,
        )
        status_data = status_resp.json()
        status = status_data.get("status", "")
        if status == "completed":
            break
        elif status == "error":
            error_info = status_data.get("error", "알 수 없는 오류")
            raise ValueError(f"Mathpix 변환 오류: {error_info}")
        time.sleep(POLL_INTERVAL)
    else:
        raise TimeoutError("Mathpix PDF 변환 타임아웃 (5분 초과)")

    # 3. .mmd 결과 다운로드
    md_resp = requests.get(
        f"{MATHPIX_API_URL}/pdf/{pdf_id}.mmd",
        headers=upload_headers,
        timeout=30,
    )
    md_resp.raise_for_status()

    # 저장
    if output_dir is None:
        output_dir = os.path.dirname(pdf_path)
    os.makedirs(output_dir, exist_ok=True)

    stem = Path(pdf_path).stem
    mmd_path = os.path.join(output_dir, f"{stem}.mmd")
    with open(mmd_path, 'w', encoding='utf-8') as f:
        f.write(md_resp.text)

    return mmd_path


# ── PDF → MMD (이미지 모드: 페이지별 고해상도) ──

def _render_page_to_png(pdf_path: str, page_num: int, dpi: int = DEFAULT_DPI) -> bytes:
    """PDF 특정 페이지를 고해상도 PNG 바이트로 렌더링 (cropbox 반영)"""
    import fitz
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_num]
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        # clip=page.rect → cropbox 영역만 렌더링 (명시적)
        pix = page.get_pixmap(matrix=mat, clip=page.rect, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def _process_single_page(pdf_path: str, page_num: int, total_pages: int,
                         app_id: str, app_key: str, dpi: int,
                         progress_callback=None) -> dict:
    """단일 페이지 처리 (재시도 포함)

    Returns:
        {"page": int, "status": "ok"|"error", "mmd": str, "error": str}
    """
    for attempt in range(MAX_RETRIES + 1):
        try:
            png_bytes = _render_page_to_png(pdf_path, page_num, dpi)
            mmd_text = image_bytes_to_mmd(png_bytes, app_id=app_id, app_key=app_key)

            if progress_callback:
                progress_callback(page_num + 1, total_pages, "ok")

            return {"page": page_num + 1, "status": "ok", "mmd": mmd_text, "error": ""}

        except Exception as e:
            logger.warning(f"페이지 {page_num + 1} 처리 실패 (시도 {attempt + 1}/{MAX_RETRIES + 1}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(2 ** attempt)  # exponential backoff
            else:
                if progress_callback:
                    progress_callback(page_num + 1, total_pages, "error")
                return {
                    "page": page_num + 1,
                    "status": "error",
                    "mmd": f"\n\n[페이지 {page_num + 1} 변환 실패: {str(e)}]\n\n",
                    "error": str(e),
                }


def pdf_to_mmd_by_pages(pdf_path: str, output_dir: str = None,
                        app_id: str = None, app_key: str = None,
                        dpi: int = DEFAULT_DPI, max_workers: int = 3,
                        progress_callback=None) -> dict:
    """PDF → MMD (이미지 모드: 페이지별 고해상도 렌더링)

    각 페이지를 PNG로 렌더링하여 Mathpix /v3/text API로 개별 전송.
    한글 인식률이 높지만 PDF 모드보다 느리고 비용이 높음.

    Args:
        pdf_path: PDF 파일 경로
        output_dir: 출력 디렉토리
        app_id, app_key: Mathpix API 키 (없으면 환경변수)
        dpi: 렌더링 해상도 (기본 300)
        max_workers: 동시 처리 페이지 수 (기본 3)
        progress_callback: fn(current_page, total_pages, status) 콜백

    Returns:
        {
            "mmd_path": str,
            "total_pages": int,
            "success_pages": int,
            "failed_pages": list[int],
            "page_results": list[dict],
        }
    """
    import fitz
    headers = _get_headers(app_id, app_key)  # 키 검증

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    doc.close()

    if output_dir is None:
        output_dir = os.path.dirname(pdf_path)
    os.makedirs(output_dir, exist_ok=True)

    # 페이지별 병렬 처리
    page_results = [None] * total_pages

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for page_num in range(total_pages):
            future = executor.submit(
                _process_single_page,
                pdf_path, page_num, total_pages,
                headers["app_id"], headers["app_key"], dpi,
                progress_callback,
            )
            futures[future] = page_num

        for future in concurrent.futures.as_completed(futures):
            page_num = futures[future]
            page_results[page_num] = future.result()

    # 결과 합치기
    mmd_parts = []
    failed_pages = []
    for result in page_results:
        if result["status"] == "error":
            failed_pages.append(result["page"])
        mmd_parts.append(result["mmd"])

    combined_mmd = "\n\n---\n\n".join(mmd_parts)

    stem = Path(pdf_path).stem
    mmd_path = os.path.join(output_dir, f"{stem}.mmd")
    with open(mmd_path, 'w', encoding='utf-8') as f:
        f.write(combined_mmd)

    return {
        "mmd_path": mmd_path,
        "total_pages": total_pages,
        "success_pages": total_pages - len(failed_pages),
        "failed_pages": failed_pages,
        "page_results": page_results,
    }


# ── 이미지 다운로드 (Mathpix CDN 등) ──

def download_image(url: str, timeout: int = 30) -> tuple[bytes, str]:
    """URL에서 이미지 다운로드

    Returns:
        (image_bytes, filename) — filename은 URL에서 추출, 확장자 .png/.jpg
    """
    response = requests.get(url, timeout=timeout, headers={
        "User-Agent": "pdf2hwpx/1.0",
    })
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "")
    data = response.content

    # 파일명 추출
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(url)
    path_name = Path(parsed.path).name  # e.g., "7ee1d5ad-...-05.jpg"

    # 확장자 결정
    if not path_name or '.' not in path_name:
        if 'png' in content_type:
            path_name = "image.png"
        else:
            path_name = "image.jpg"

    # jpg → png 변환 (HWPX 호환성)
    ext = path_name.rsplit('.', 1)[-1].lower()
    if ext in ('jpg', 'jpeg', 'webp'):
        try:
            from PIL import Image as PILImage
            img = PILImage.open(io.BytesIO(data))
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            data = buf.getvalue()
            path_name = path_name.rsplit('.', 1)[0] + '.png'
        except Exception:
            pass  # 변환 실패 시 원본 유지

    return data, path_name


def get_image_dimensions(image_bytes: bytes) -> tuple[int, int]:
    """이미지 바이트에서 가로/세로 픽셀 크기 반환"""
    from PIL import Image as PILImage
    img = PILImage.open(io.BytesIO(image_bytes))
    return img.size  # (width, height)


# ── PDF 직접 이미지 추출 ──

def extract_images_from_pdf(pdf_path: str, min_size: int = 50) -> list[dict]:
    """PDF에서 이미지를 직접 추출 (Mathpix 불필요)

    Args:
        pdf_path: PDF 파일 경로
        min_size: 최소 이미지 크기 (px). 너무 작은 아이콘 등 제외

    Returns:
        list of {
            "page": int (1-indexed),
            "bbox": (x0, y0, x1, y1),  # 페이지 내 위치 (pt 단위)
            "y_position": float,  # 페이지 내 세로 위치 비율 (0~1)
            "width": int, "height": int,
            "data": bytes (PNG),
            "filename": str,
        }
    """
    import fitz

    doc = fitz.open(pdf_path)
    results = []
    img_counter = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_height = page.rect.height
        cropbox = page.cropbox  # cropbox 영역 (크롭 설정 시 mediabox와 다름)

        # get_text('dict')로 이미지 블록(위치 포함) 추출
        blocks = page.get_text('dict')['blocks']
        img_blocks = [b for b in blocks if b['type'] == 1]

        for ib in img_blocks:
            w, h = ib['width'], ib['height']
            if w < min_size or h < min_size:
                continue

            bbox = ib['bbox']

            # cropbox 밖 이미지 필터링 (크롭 영역 안에 50% 이상 있어야 포함)
            img_rect = fitz.Rect(bbox)
            intersect = img_rect & fitz.Rect(cropbox)
            if intersect.is_empty:
                continue
            overlap = intersect.width * intersect.height
            img_area = max(img_rect.width * img_rect.height, 1)
            if overlap / img_area < 0.5:
                continue

            y_pos = (bbox[1] - cropbox.y0) / max(page_height, 1)  # cropbox 기준 비율

            # 이미지 데이터 추출 + 크기 최적화
            MAX_DIM = 800  # 최대 800px (HWPX/에디터용으로 충분)
            try:
                img_data = ib.get('image')
                if img_data:
                    from PIL import Image as PILImage
                    pil_img = PILImage.open(io.BytesIO(img_data))
                else:
                    continue
            except Exception:
                try:
                    raw_images = page.get_images(full=True)
                    if not raw_images:
                        continue
                    xref = raw_images[0][0]
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n >= 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    from PIL import Image as PILImage
                    pil_img = PILImage.open(io.BytesIO(pix.tobytes("png")))
                except Exception:
                    continue

            # 리사이즈 (너무 크면 축소)
            if max(pil_img.size) > MAX_DIM:
                ratio = MAX_DIM / max(pil_img.size)
                new_size = (int(pil_img.size[0] * ratio), int(pil_img.size[1] * ratio))
                pil_img = pil_img.resize(new_size, PILImage.LANCZOS)

            buf = io.BytesIO()
            pil_img.save(buf, format='PNG', optimize=True)
            png_data = buf.getvalue()

            img_counter += 1
            results.append({
                "page": page_num + 1,
                "bbox": tuple(bbox),
                "y_position": y_pos,
                "width": w,
                "height": h,
                "data": png_data,
                "filename": f"pdf_img_{img_counter}.png",
            })

    doc.close()
    logger.info(f"PDF 직접 추출: {len(results)}개 이미지")
    return results
