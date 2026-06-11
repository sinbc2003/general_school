#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  frontend/src/components/whiteboard/WhiteboardCanvas.tsx \
  frontend/src/lib/open-tool-window.ts \
  "frontend/src/app/(admin)/layout.tsx" \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/quiz/[sid]/host/page.tsx" \
  "frontend/src/app/(admin)/tools/wordbook/[did]/page.tsx" \
  frontend/src/components/drive/DrivePage.tsx \
  scripts/commit_cursors.sh

git commit -m "feat(tools): 화이트보드 실시간 커서 + 새창 전면 사이드바 제거

화이트보드 동시작업 커서 (Figma/Jamboard식):
- 포인터 이동을 awareness 'cursor' 필드로 broadcast (40ms throttle, 논리 좌표)
- 다른 참가자 포인터를 색상 화살표 + 이름표로 오버레이 표시
  (이름 해시 색, 본인 제외, 캔버스 이탈 시 잔상 제거)
- 좌표는 논리 1920×1080 공유 → 화면 크기 달라도 같은 위치

도구 새창 = 사이드바 완전 제거 (해당 에듀테크처럼 꽉 차게):
- openToolWindow 헬퍼 — 새창에 window.name='gs-embed-*' 부여
  (창 이름은 창 내 어떤 이동에도 유지 → 새창 안에서는 계속 풀스크린)
- admin 레이아웃: gs-embed 창이면 사이드바·모바일헤더·여백 없이 렌더
- 적용: 도구 허브 카드, 퀴즈 진행, 단어장 편집, 드라이브 단어장 새창
  (보드·화이트보드는 기존 /embed/* 라우트 그대로 — 이미 풀스크린)

검증: tsc 0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
