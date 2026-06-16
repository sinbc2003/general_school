"""벤더 pdf2hwpx 엔진 래퍼.

원본 진입점: app.vendor.pdf2hwpx.packages.core.converter.convert_pdf
(README "다른 플랫폼에서 사용하기" 임베드 API).

convert_pdf 는 동기 + 네트워크(Mathpix)/CPU 바운드이므로 반드시
asyncio.to_thread 로 호출해야 한다 (runner.py 에서 처리).

Windows 전용 한글 COM 후처리(hwp_postprocess)는 Linux에서 import 실패 →
ir_to_hwpx 내부 try/except 로 자동 skip (수식 크기 재계산만 생략, 변환 자체는 정상).
"""

import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def convert_pdf_to_hwpx(
    pdf_bytes: bytes,
    out_path: str,
    *,
    app_id: str,
    app_key: str,
    mode: str = "hybrid",
    doc_type: str = "exam",
    columns: int = 1,
) -> dict:
    """PDF bytes → HWPX 파일(out_path). 동기 함수 (반드시 to_thread로 호출).

    Returns dict: hwpx_path, mmd, total_pages, success_pages, failed_pages, warnings
    """
    # converter 모듈 로드 시 자체 sys.path 설정 → 이후 flat import 가능
    from app.vendor.pdf2hwpx.packages.core.converter import (  # noqa: PLC0415
        ConvertOptions,
        convert_pdf,
    )

    tmpdir = tempfile.mkdtemp(prefix="p2h_")
    in_path = os.path.join(tmpdir, "input.pdf")
    with open(in_path, "wb") as f:
        f.write(pdf_bytes)

    if columns == 1:
        # 가장 충실한 경로 — convert_pdf 가 내부에서 parse_mmd + ir_to_hwpx 수행
        options = ConvertOptions(
            mode=mode,
            doc_type=doc_type,
            app_id=app_id,
            app_key=app_key,
            output_hwpx=out_path,
        )
        result = convert_pdf(in_path, options)
        if not result.hwpx_path:
            raise RuntimeError("HWPX 생성 실패 (OCR 결과가 비어 있거나 변환 오류)")
    else:
        # 2단 등 컬럼 옵션 — MMD만 받고 ir_to_hwpx를 직접 호출
        options = ConvertOptions(
            mode=mode, doc_type=doc_type, app_id=app_id, app_key=app_key
        )
        result = convert_pdf(in_path, options)
        if not result.mmd:
            raise RuntimeError("OCR 결과가 비어 있습니다 (Mathpix 응답 없음)")
        from mmd_parser import parse_mmd  # noqa: PLC0415 — converter가 sys.path 설정
        from pipeline import ir_to_hwpx  # noqa: PLC0415

        doc_ir = parse_mmd(result.mmd, source="input.pdf")
        ir_to_hwpx(doc_ir, out_path, columns=columns)

    return {
        "hwpx_path": out_path,
        "mmd": result.mmd or "",
        "total_pages": result.total_pages,
        "success_pages": result.success_pages,
        "failed_pages": list(result.failed_pages or []),
        "warnings": list(result.warnings or []),
    }
