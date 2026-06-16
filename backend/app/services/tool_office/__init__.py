"""업무 도구 서비스 — PDF→HWPX 변환, PDF 번역.

- config.py            : Mathpix API 키 저장/조회 (SchoolConfig + Fernet)
- llm.py               : 플랫폼 LLM(챗봇 인프라) 1-shot 완성 헬퍼
- engine_pdf2hwpx.py   : 벤더 pdf2hwpx 엔진 래퍼 (동기)
- translate.py         : PDF 텍스트 추출 + LLM 번역 (동기 추출 / async 번역)
- runner.py            : 백그라운드 잡 실행 (자체 DB 세션, to_thread, 진행률)
"""
