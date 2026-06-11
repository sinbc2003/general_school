#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/models/__init__.py \
  backend/app/models/tool_share.py \
  backend/app/services/tool_share.py \
  backend/alembic/versions/a2c4e6f8b1d3_edu_tool_shares.py \
  backend/app/modules/tool_board/router.py \
  backend/app/modules/tool_wordbook/router.py \
  backend/app/modules/tool_wordbook/schemas.py \
  backend/app/modules/classroom/posts.py \
  backend/app/modules/classroom/schemas.py \
  backend/tests/test_edutools.py \
  frontend/src/lib/sidebar-context.tsx \
  frontend/src/lib/use-tool-focus.ts \
  frontend/src/components/board/BoardView.tsx \
  frontend/src/components/tools/ToolShareModal.tsx \
  frontend/src/components/classroom/WordDeckPickerModal.tsx \
  frontend/src/components/classroom/BoardPickerModal.tsx \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/board/page.tsx" \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  "frontend/src/app/(admin)/tools/wordbook/page.tsx" \
  "frontend/src/app/(admin)/tools/wordbook/[did]/page.tsx" \
  "frontend/src/app/(admin)/tools/wordbook/shared" \
  "frontend/src/app/(admin)/tools/quiz/[sid]/host/page.tsx" \
  "frontend/src/app/(admin)/tools/mini/page.tsx" \
  "frontend/src/app/(student)/s/board/[bid]/page.tsx" \
  CLAUDE.md \
  scripts/check_share_backend.sh scripts/commit_share.sh

git commit -m "feat(tools): 교사 간 공유+사본 / 보드 Padlet 디자인 / 새창·집중모드 / 학기 귀속 정책

공유 (사용자 요청):
- EduToolShare 모델 (board|word_deck) + services/tool_share.py + alembic a2c4e6f8b1d3
- 공유받은 교사: 원본 열람만 (보드 viewer / 단어장 study 미리보기)
  → duplicate로 사본(카드·yjs_state 복제) 생성해 본인 강좌에 첨부 (원본 보존)
- ToolShareModal(UserPicker 교사탭) + 목록·피커 '나에게 공유됨' 섹션
  (피커에서 공유 항목 선택 = 자동 사본 생성 후 첨부)

보드 Padlet 디자인:
- 배경 테마 8종 (settings.background) + 반투명 컬럼 + 카드 색 선택
- 작성자 아바타·상대시간, 컬럼 헤더 ⊕ 컴포저(Ctrl+Enter), 최신 카드 위로
- 메타 로드 즉시 월 렌더 — Yjs 연결은 비차단 ('연결 중' 칩)
  ※ 생성 지연 진단: B 백엔드 POST 실측 3ms — 원인은 페이지 전환 청크 로드
    (터널 경유 시)와 구 버전의 sync 전체 블로킹. 후자 해결.

새창 + 집중모드:
- useToolFocusMode — 도구 실행 페이지 진입 시 사이드바 일시 접힘(이탈 시 복원)
- 허브 카드·보드/단어장/퀴즈호스트 헤더 '새 창' 버튼

학기 귀속 정책 (확정·구현):
- 도구 원본 = 교사 자산 (학기 무관 재사용, 드라이브 자료와 동일)
- 보드 접근 = 활성 학기 첨부/강좌만 (라이브 활동 — 학기 전환 시 재첨부)
- 단어장 = 지난 학기 첨부로도 계속 학습 (복습 연속성, 의도된 비대칭)

기타: 첨부 제목 enrichment에 도구 3종 추가, 타이머 연타 방어,
AudioContext 제스처 시점 생성, /decks/{did} 라우트 충돌 회피(/shared-with-me)

검증: pytest 43/43 (신규 공유·사본·학기게이트 3종 포함), tsc 0, boot 639 routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
