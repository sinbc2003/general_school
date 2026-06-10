#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/main.py \
  backend/app/models/__init__.py \
  backend/app/models/tool_wordbook.py \
  backend/app/modules/tool_wordbook \
  backend/app/modules/classroom/schemas.py \
  backend/alembic/versions/8e5f2a9b3c1d_wordbook_tables.py \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/wordbook" \
  "frontend/src/app/(student)/s/wordbook" \
  frontend/src/components/wordbook \
  frontend/src/components/classroom/WordDeckPickerModal.tsx \
  frontend/src/components/classroom/AssignmentModal.tsx \
  frontend/src/components/classroom/PostDetailView.tsx \
  frontend/src/config/student-menu.ts \
  frontend/src/config/menu-categories.ts \
  scripts/check_wordbook_backend.sh

git commit -m "feat(tools): 단어장(ClassCard형) Phase 2 — 라이트너 학습 3모드

- WordDeck/WordCard/WordStudyState 모델 + alembic 8e5f2a9b3c1d (멱등)
- tool_wordbook 모듈: 덱·카드 CRUD, CSV 가져오기(UTF-8/CP949, 양식 다운로드),
  학습 study/progress (라이트너 box 1~5 — 맞히면 +1, 틀리면 1로 리셋)
- 학습 화면 StudyView 공유 컴포넌트: 플래시카드/4지선다/스펠 타이핑 3모드,
  box 낮은 순·오답 많은 순 우선 출제, 세션 종료 후 '틀린 것만 다시'
- 교사 /tools/wordbook 덱 목록·편집(인라인 CRUD+공개 토글+학습 미리보기 탭)
- 학생 /s/wordbook 홈(최근 학습+공개 덱) + /s/wordbook/[did] 학습
- 클래스룸 첨부 type=word_deck: 피커+렌더러, 강좌 글 첨부 = 수강생 학습 접근
  (attachment_share 패턴의 LIKE prefilter 가드)
- 권한 tools.wordbook.manage (교사 자동 부여), 학습은 인증+가드
- 검증: backend 621 routes boot, invariants 26/26, tsc 0 error

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
