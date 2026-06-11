#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/modules/tool_board/router.py \
  frontend/src/components/board/BoardView.tsx \
  "frontend/src/app/(admin)/tools/board/page.tsx" \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  scripts/commit_padlet_clone.sh

git commit -m "feat(board): Padlet 클론 개선 — 담벼락 masonry·카드 구조·슬라이드쇼·검색

실제 Padlet 스크린샷 기준 클론:
- 담벼락(wall) 레이아웃 신규 — 섹션 패널 없이 카드가 배경 위 masonry로 흐름
  (CSS columns, 신규 보드 기본값. 기존 보드는 shelf 유지 — 설정에서 전환)
- 카드 구조 Padlet 동일화: 상단 작성자 헤더(아바타+이름+상대시간, hover 수정·삭제),
  제목 → 이미지 → 본문 → 링크 미리보기 → 구분선 → 하단 반응 행
  (하트 + '댓글 추가' pill)
- 상단 툴바 Padlet 배치: 우상단 아이콘 행(검색 토글·슬라이드쇼·정렬·CSV·연결),
  좌측 작성자 라인 + 큰 제목
- 카드 검색 (제목/본문/작성자 필터 — shelf/wall/canvas 공통)
- 슬라이드쇼: 카드 한 장씩 풀스크린 (←/→/Space/Esc, 하트 수 표시)
- 우하단 '+ 게시' 테일 플로팅 버튼 + 떠있는 컴포저 (wall·shelf)
- 새 보드 모달: 형식 비주얼 카드 선택(담벼락/컬럼/자유배치, 미니 프리뷰+체크),
  컬럼 입력은 shelf 선택 시만, 생성 API가 layout/background 직접 수용

검증: pytest 29/29, tsc 0, 654 routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
