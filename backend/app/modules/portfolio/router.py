"""학생 포트폴리오 라우터 — 성적, 수상, 논문, 상담, 모의고사, 생기부.

분할 구조 (sub-router 패턴):
- crud.py — 6개 리소스 (Grade/MockExam/Award/Thesis/Counseling/Record) list+create+update+delete + 포트폴리오 summary
- analytics.py — stats + timeline
- io.py — CSV template + import + export
- pdf_report.py — 생기부 PDF 출력
- teacher_views.py — 교사용 학생 산출물/진로 조회 + 공개 산출물 갤러리

본 파일은 APIRouter() 생성과 sub-module 등록만 담당.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/students", tags=["students"])


# Sub-modules — endpoint 등록 강제 (마지막에 import해 순환 회피)
from app.modules.portfolio import crud  # noqa: E402, F401
from app.modules.portfolio import analytics  # noqa: E402, F401
from app.modules.portfolio import io  # noqa: E402, F401
from app.modules.portfolio import pdf_report  # noqa: E402, F401
from app.modules.portfolio import teacher_views  # noqa: E402, F401
