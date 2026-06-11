#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/services/folder_seed.py \
  backend/app/modules/timetable/semesters.py \
  backend/app/modules/tool_board/router.py \
  backend/app/modules/files/router.py \
  backend/tests/test_edutools.py \
  frontend/src/components/board/BoardView.tsx \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  scripts/commit_padlet.sh

git commit -m "feat(board): Padlet 동급 기능 전체 + 학기 전환 드라이브 자동 보관

보드 Padlet 패리티 (섹션을 DB settings → Yjs Y.Map('board')로 이전, 실시간 동기):
- 섹션 동적 관리: 보드 위 '+ 섹션 추가', 이름 클릭 수정, 삭제(카드는 첫 섹션으로),
  좌우 이동 — 3개 고정 해제. 레거시 카드 column index → 'col-{i}' 매핑, 1회 자동 seed
- 카드: 제목(선택)+본문, 이미지 업로드(PIL 압축, files 가드 _guard_boards),
  링크 첨부, 드래그&드롭 섹션 간/내 이동(fractional pos)
- 좋아요 Y.Map('likes') 본인 키만 set/delete(충돌 0), 카드 댓글 Y.Map('comments') 스레드
- 정렬 토글: 최신순/좋아요순/수동(드래그 시 자동 전환)
- 승인 후 게시(requires_approval — 미승인은 본인+교사만, 승인 버튼),
  작성자 익명 표시(hide_authors), 새 카드 위치(top/bottom), 기본 정렬 설정
- CSV 내보내기(교사), 설정 모달 개편(컬럼 입력 제거 — 섹션은 보드에서 직접)
- POST /boards/{bid}/upload-image (can_write) + storage 'boards' 섹션 가드

학기 전환 드라이브 자동 보관 (set-current hook):
- 이전 학기 자동 폴더 → 사용자별 최상위 '1. 2026-1학기' 보관 폴더로 이동
- 학기 단위 폴더는 항상, 학년 단위(담임/학급)는 연도 바뀔 때만. 멱등, 백그라운드

검증: pytest 56/56 (아카이브·업로드 가드·설정 테스트 +4), tsc 0, 640 routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
