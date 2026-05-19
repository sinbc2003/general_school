"""클래스룸 설문지 라우터 — sub-module 패턴.

경로 요약:
  GET    /api/classroom/surveys                       내 접근 가능 설문 목록
  POST   /api/classroom/surveys                       설문 생성
  GET    /api/classroom/surveys/{sid}                 설문 상세 (질문 포함)
  PUT    /api/classroom/surveys/{sid}                 메타 편집
  DELETE /api/classroom/surveys/{sid}                 삭제

  POST   /api/classroom/surveys/{sid}/questions       질문 추가
  PUT    /api/classroom/surveys/questions/{qid}       질문 편집
  DELETE /api/classroom/surveys/questions/{qid}       질문 삭제

  POST   /api/classroom/surveys/{sid}/responses       응답 제출
  GET    /api/classroom/surveys/{sid}/results         결과 (작성자/admin)
  GET    /api/classroom/surveys/{sid}/results.csv     CSV 다운로드

분할:
  - _helpers.py: is_admin / can_manage / can_respond / dict 변환 / archived 가드
  - crud.py: Survey CRUD
  - questions.py: SurveyQuestion CRUD (draft만 변경 가능)
  - responses.py: 응답 제출 (필수 검증 + 중복 차단 + 익명 처리)
  - results.py: 결과 집계 + CSV
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/classroom/surveys", tags=["classroom-surveys"])

# Sub-modules — endpoint 등록 강제. 마지막에 import해 순환 회피.
from app.modules.classroom_surveys import crud  # noqa: E402, F401
from app.modules.classroom_surveys import questions  # noqa: E402, F401
from app.modules.classroom_surveys import responses  # noqa: E402, F401
from app.modules.classroom_surveys import results  # noqa: E402, F401
