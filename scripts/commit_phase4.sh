#!/bin/bash
set -e
cd /home/sinbc/general_school

git add \
  "frontend/src/app/(admin)/tools/mini/page.tsx" \
  "frontend/src/app/(admin)/tools/page.tsx" \
  "frontend/src/app/(student)/s/quiz/[pin]/page.tsx" \
  frontend/src/components/classroom/PostDetailView.tsx \
  backend/app/modules/tool_quiz/router.py \
  backend/app/modules/tool_wordbook/router.py \
  backend/tests/test_edutools.py \
  CLAUDE.md \
  HANDOFF_NEXT_SESSION.md \
  scripts/commit_quiz.sh scripts/commit_wordbook.sh scripts/commit_board.sh scripts/commit_phase4.sh

git commit -m "feat(tools): Phase 4 수업 소도구 + 검수 수정 + 통합 테스트 14종 + 문서

Phase 4 — /tools/mini (백엔드 0, 클라이언트 only):
- 이름 뽑기 룰렛 (슬롯머신 감속, 뽑힌 사람 제외), 모둠 편성 (모둠수/인원),
  타이머 (WebAudio 비프 + 점멸 + 프리셋), 신호등 (키보드 1/2/3)
- 명단은 본인 강좌 학생 목록 API 재사용 + 직접 입력 겸용, 전체 화면 버튼

멀티에이전트 검수 (6차원 탐색 → 3-lens 반박 검증, 51 agents) 확정건 수정:
- quiz submit_answer / wordbook record_progress: 동시 더블클릭 시
  UNIQUE IntegrityError → 500 대신 409 (확정 race)
- quiz info: PIN 노출 범위 축소 — host/admin 또는 퀴즈가 첨부된 강좌 멤버만
  (sid 열거로 타 수업 PIN 취득 차단) + 프론트 권한/종료 메시지 분리
- wordbook CSV 헤더 감지: 1열+2열 동시 매칭일 때만 skip ('word' 단어 행 오인 방지)
- quiz numeric 입력 NaN 가드

테스트: tests/test_edutools.py 14개 신규 — 퀴즈 풀플로우(상태머신·점수·마스킹·
중복 409·분포)+IDOR+PIN 노출 범위 / 단어장 라이트너(2→3→1)·CSV·첨부=접근권한 /
보드 권한 매트릭스·보관 readonly·yjs-snapshot 내부토큰 roundtrip

문서: CLAUDE.md 2026-06-10~11 세션 기록 + HANDOFF_NEXT_SESSION.md 차기 작업 재작성

검증: pytest 40/40 (edutools 14 + invariants 5 + storage 21), tsc 0, boot 629 routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"

git push origin main
git log --oneline -1
