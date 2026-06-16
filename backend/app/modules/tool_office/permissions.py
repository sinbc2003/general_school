"""업무 도구 권한 (PDF→HWPX 변환, PDF 번역)."""

PERMISSIONS = [
    {
        "key": "tools.office.use",
        "display_name": "업무 도구 사용",
        "category": "업무 도구",
        "description": "PDF→HWPX 변환·PDF 번역 (교사·직원)",
    },
    {
        "key": "tools.office.configure",
        "display_name": "업무 도구 설정(Mathpix)",
        "category": "업무 도구",
        "description": "PDF→HWPX 변환에 사용하는 Mathpix API 키 설정 (관리자 전용)",
    },
]
