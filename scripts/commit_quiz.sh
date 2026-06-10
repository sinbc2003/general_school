#!/bin/bash
set -e
cd /home/sinbc/general_school
chmod 644 production/scripts/gs-autoip.sh scripts/setup-production.sh

git add \
  backend/app/main.py \
  backend/app/models/__init__.py \
  backend/app/models/tool_quiz.py \
  backend/app/modules/tool_quiz \
  backend/app/modules/classroom/schemas.py \
  backend/alembic/versions/7c4d1e8f2a3b_live_quiz_tables.py \
  "frontend/src/app/(admin)/tools" \
  "frontend/src/app/(student)/s/quiz" \
  frontend/src/components/classroom/QuizPickerModal.tsx \
  frontend/src/components/classroom/AssignmentModal.tsx \
  frontend/src/components/classroom/PostDetailView.tsx \
  frontend/src/config/admin-menu.ts \
  frontend/src/config/menu-categories.ts \
  frontend/src/config/student-menu.ts \
  scripts/check_frontend.sh \
  scripts/check_quiz_backend.sh

git commit -m "feat(tools): 업무 및 수업 도구 카테고리 + 라이브 퀴즈(Kahoot형) Phase 1

- 사이드바 새 카테고리 '업무 및 수업 도구' ('수업' 다음) + /tools 허브 페이지
- 라이브 퀴즈: 코스웨어 문제 세트 → 게임 세션 (6자리 PIN + QR 입장)
  · 호스트 진행: 로비 → 문제(카운트다운·제출현황) → 공개(분포·리더보드) → 포디움
  · 학생 /s/quiz PIN 입장 + 보기 버튼/단답/수치 풀이 (2초 폴링, WS는 v2)
  · Kahoot식 속도 점수 1000×(1-(t/limit)/2), grade_answer 재사용
  · 자동채점 가능 문제만 세션 생성 시 snapshot
- 클래스룸 첨부 type=live_quiz: 피커 + 렌더러 (학생 클릭 → PIN 자동 입장)
- alembic 7c4d1e8f2a3b: live_quiz_sessions/players/answers (멱등)
- 권한 tools.quiz.host (교사 자동 부여), 참여는 인증만
- 검증: backend 607 routes boot, invariants 26/26, tsc 0 error

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
