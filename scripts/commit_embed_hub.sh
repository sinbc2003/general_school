#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  frontend/src/app/embed/board \
  frontend/src/app/embed/whiteboard \
  frontend/src/components/board/BoardView.tsx \
  frontend/src/components/whiteboard/WhiteboardCanvas.tsx \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/board/page.tsx" \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  "frontend/src/app/(admin)/tools/whiteboard/page.tsx" \
  "frontend/src/app/(admin)/tools/whiteboard/[wid]/page.tsx" \
  frontend/src/components/drive/DrivePage.tsx \
  scripts/commit_embed_hub.sh

git commit -m "feat(tools): 새 창 풀스크린(embed) + 도구 허브 미니 목업 미리보기

새 창 = 사이드바 없는 전체 화면 (Padlet처럼):
- /embed/board/[bid], /embed/whiteboard/[wid] 신규 — 기존 embed layout 재사용
  (admin 사이드바·헤더 우회, 인증은 layout이 처리)
- BoardView/WhiteboardCanvas에 fullscreen prop — 라운드·그림자 제거 +
  min-h-screen, '+ 게시' 플로팅은 viewport 고정(fixed)
- 모든 '새 창' 버튼(보드 상세/목록 카드, 화이트보드 상세/목록 카드,
  드라이브 우클릭) → embed 경로로 연결

도구 허브 카드 미니 목업 미리보기 (Padlet 형식 갤러리 스타일):
- 퀴즈(4지선다 타일+타이머바), 단어장(플래시카드 스택+라이트너 점),
  보드(노을 배경 masonry 카드), 화이트보드(모눈+스트로크 SVG),
  소도구(룰렛·타이머·신호등) — 도구별 실제 화면 축소 목업
- 카드 hover 시 새 창 버튼, 아이콘은 본문 행으로 이동

검증: tsc 0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
