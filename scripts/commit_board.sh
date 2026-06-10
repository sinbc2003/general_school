#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/main.py \
  backend/app/models/__init__.py \
  backend/app/models/tool_board.py \
  backend/app/modules/tool_board \
  backend/app/modules/classroom/schemas.py \
  backend/alembic/versions/9f6a3b4c5d2e_tool_boards.py \
  backend-hocuspocus/src/auth.ts \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/board" \
  "frontend/src/app/(student)/s/board" \
  frontend/src/components/board \
  frontend/src/components/classroom/BoardPickerModal.tsx \
  frontend/src/components/classroom/AssignmentModal.tsx \
  frontend/src/components/classroom/PostDetailView.tsx \
  scripts/check_board_backend.sh

git commit -m "feat(tools): 보드(Padlet형) Phase 3 — Yjs 실시간 담벼락

- ToolBoard 모델 (yjs_state snapshot + settings.columns) + alembic 9f6a3b4c5d2e
- tool_board 모듈 prefix=/api/classroom/boards (Hocuspocus resourcePath 규약)
  · CRUD + permission + yjs-snapshot GET/POST (INTERNAL_TOKEN, sheets 패턴)
  · 접근: owner/admin/강좌멤버/강좌 글 첨부/public 모두 읽기+쓰기 (참여형)
- backend-hocuspocus auth.ts: TargetKind 'board' + board-{id} documentName
- BoardView 공유 컴포넌트: Y.Map('cards') 카드 단위 LWW, 컬럼 레이아웃,
  포스트잇 추가/수정/삭제(본인+소유자), awareness 인원 표시, 재연결 표시
- 교사 /tools/board 목록·상세(컬럼/공개 설정·삭제), 학생 /s/board/[bid] 참여
- 클래스룸 첨부 type=board: 피커+렌더러 (첨부 = 수강생 카드 붙이기 권한)
- 권한 tools.board.manage (교사 자동 부여)
- 검증: backend 629 routes boot, hocuspocus tsc OK, invariants 26/26, tsc 0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
