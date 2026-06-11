#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  backend/app/models/tool_whiteboard.py \
  backend/app/models/__init__.py \
  backend/alembic/versions/c6e8f0a2b4d6_tool_whiteboards.py \
  backend/app/modules/tool_whiteboard \
  backend/app/modules/tool_board/router.py \
  backend/app/modules/drive/router.py \
  backend/app/modules/drive/organize.py \
  backend/app/modules/classroom/schemas.py \
  backend/app/main.py \
  backend/tests/test_edutools.py \
  backend-hocuspocus/src/auth.ts \
  frontend/src/components/whiteboard \
  "frontend/src/app/(admin)/tools/whiteboard" \
  "frontend/src/app/(student)/s/whiteboard" \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(admin)/tools/board/[bid]/page.tsx" \
  frontend/src/components/classroom/WhiteboardPickerModal.tsx \
  frontend/src/components/classroom/AssignmentModal.tsx \
  frontend/src/components/classroom/PostDetailView.tsx \
  frontend/src/components/board/BoardView.tsx \
  frontend/src/components/drive/_drive-shared.ts \
  frontend/src/components/drive/DrivePage.tsx \
  frontend/src/components/drive/useDriveRename.ts \
  frontend/src/components/drive/ShareFromDrive.tsx \
  scripts/check_wb_backend.sh scripts/commit_wb.sh

git commit -m "feat(tools): 보드 v2 + 공유 화이트보드 신규 도구

보드 v2:
- 자유배치 캔버스 레이아웃 (settings.layout=canvas) — 카드 x/y 드래그 이동,
  플로팅 + 컴포저, 설정 모달 레이아웃 선택
- 카드 링크 OG 미리보기 (embeds/og-preview 재사용 — 이미지·제목·설명 카드)
- 카드 댓글 알림: POST /boards/{bid}/notify-comment (can_write 가드) →
  카드 작성자에게 in-app 알림 (역할별 링크)
- 보드 영구삭제 시 카드 이미지 디렉토리 정리 — drive CLEANUP_HOOKS
  (영구삭제·휴지통 비우기·30일 purge cron 3경로 공통)

공유 화이트보드 (신규 도구 #5 — Jamboard식 실시간 드로잉):
- ToolWhiteboard 모델 (alembic c6e8f0a2b4d6) + tool_whiteboard 모듈
  (CRUD/공유/사본/permission/yjs-snapshot — tool_board 골격 미러)
- hocuspocus auth.ts TargetKind 'whiteboard' (whiteboard-{id})
- WhiteboardCanvas: Y.Map('strokes') 객체 단위 LWW, 논리 1920×1080 좌표 공유,
  펜/형광펜/직선/사각형/원/텍스트/지우개(본인 것·교사 전부), 색 6·굵기 3,
  실행취소(본인), 전체 지우기(교사), PNG 내보내기, 배경 흰색/모눈/칠판
- 클래스룸 첨부 type=whiteboard (첨부=그리기 권한, 활성 학기 한정)
- 교사 간 공유(열람)+사본, 드라이브 통합(whiteboards — 폴더·휴지통·이름변경·복사)
- 허브 5번째 카드, 교사/학생 페이지, 집중 모드·새창

검증: pytest 50/50 (화이트보드 풀매트릭스·보드 layout/알림 +2), tsc 0,
654 routes, hocuspocus build OK

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
