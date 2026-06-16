"""pdf2hwpx 변환 엔진 (벤더링).

원본: sbc_lab/008_pdf2hwpx (PDF → Mathpix OCR → MMD → IR → HWPX).
packages/ 디렉터리를 그대로 가져옴 (Next.js 에디터 + Windows COM 후처리 제외).

진입점: app.services.tool_office.engine_pdf2hwpx.convert_pdf_to_hwpx
(동기 + 네트워크/CPU 바운드 → 반드시 asyncio.to_thread로 호출).
"""
