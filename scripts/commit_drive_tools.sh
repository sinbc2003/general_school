#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/models/tool_wordbook.py \
  backend/app/models/tool_board.py \
  backend/alembic/versions/b4d6e8f0a2c4_tool_drive_columns.py \
  backend/app/modules/drive/router.py \
  backend/app/modules/drive/organize.py \
  backend/app/modules/tool_wordbook/router.py \
  backend/app/modules/tool_board/router.py \
  backend/tests/test_edutools.py \
  frontend/src/components/drive/_drive-shared.ts \
  frontend/src/components/drive/DrivePage.tsx \
  frontend/src/components/drive/NewItemMenu.tsx \
  frontend/src/components/drive/useDriveRename.ts \
  frontend/src/components/drive/DriveContextMenu.tsx \
  frontend/src/components/drive/MoveToFolderModal.tsx \
  frontend/src/components/drive/DriveProposalModal.tsx \
  frontend/src/components/drive/ShareFromDrive.tsx \
  "frontend/src/app/(admin)/tools/wordbook/[did]/page.tsx" \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  CLAUDE.md \
  scripts/commit_drive_tools.sh

git commit -m "feat(tools): 단어장·보드 내 드라이브 통합 — 폴더·휴지통·이름변경·복사

- WordDeck/ToolBoard에 folder_id/deleted_at/deleted_by(+storage_bytes) 추가
  (alembic b4d6e8f0a2c4, 멱등) → drive ITEM_TYPES에 word_decks/boards 등록
- 드라이브 제네릭 기능 전부 작동: 학기 자동 폴더 정리, 휴지통 30일·복구·
  영구삭제(cron 포함), F2 이름변경, Ctrl+C 복사(카드/yjs_state 복제),
  '+신규'로 드라이브에서 바로 생성, AI 정리, 검색·즐겨찾기
- 도구의 '삭제' = 휴지통 이동으로 전환 (공유 row는 복구 대비 유지,
  휴지통 자료는 도구 목록·공유·접근 가드에서 숨김)
- 학기 전환 활용: 도구 원본(교사 자산)을 드라이브의 학기 폴더에 보관 —
  학기 바뀌어도 내 드라이브에서 찾아 새 강좌에 재첨부
- 드라이브 공유 우클릭은 도구 타입이면 도구 페이지 공유로 안내
- 학생 드라이브 '+신규'에선 교사 전용 도구 2종 숨김
- 검증: pytest 53/53 (드라이브 roundtrip·복사 테스트 +2), tsc 0, 639 routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
