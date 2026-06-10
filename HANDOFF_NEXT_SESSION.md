# 다음 세션 인계 — "업무 및 수업 도구" (에듀테크 자체 구현)

> 사용자가 **"이어서"** 라고 하면 이 문서를 읽고 §3 작업을 바로 시작한다.
> (작성: 2026-06-10 — 이전 인계분(enrollment 연동 등)은 전부 완료·배포됨)

---

## 1. 환경 / 작업 방법 (요약 — 상세는 CLAUDE.md)

- **코드**: WSL `/home/sinbc/general_school` = GitHub `sinbc2003/general_school`
  파일 편집은 `\\wsl.localhost\ubuntu\home\sinbc\general_school\...` 경로로 Read/Edit/Write.
- **운영 서버 B**: `ssh susung@100.92.66.61` — pubedu.com(Cloudflare 터널)으로 서비스 중.
- **배포 절차** (매 단계 커밋 후):
  1. `git add <files> && git commit && git push origin main` (main 직접, PR 안 씀)
  2. B: pull → (alembic 변경 시 `alembic upgrade head`) → frontend 변경 시
     `npm run build` (백그라운드 nohup + /tmp/gs-build.done 폴링) → `sudo systemctl restart gs-backend gs-frontend` → `/api/health` 200 확인
  3. ⚠️ **PowerShell→wsl→ssh 따옴표 깨짐** → `/tmp/스크립트.sh` 작성 후
     `wsl -d Ubuntu bash -lc 'ssh -o BatchMode=yes susung@100.92.66.61 bash -s < /tmp/스크립트.sh'`
- **검증 루틴**: frontend `npx tsc --noEmit` / backend boot+routes 체크 스크립트 +
  `pytest tests/test_convention_invariants.py tests/test_storage_security.py` / alembic은 dev 먼저.
- **커밋 서명**: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## 2. 프로젝트 목표

**'수업'(클래스룸) 카테고리 다음에 사이드바 새 카테고리 "업무 및 수업 도구"를 만들고,
교사들이 많이 쓰는 에듀테크들을 하나씩 자체 구현한다.**
핵심 요구 2가지:
1. 도구마다 독립 사용 가능 (교사가 만들고 학생이 참여)
2. **만든 것을 클래스룸에 가져와 쓸 수 있어야 함** (첨부 통합 — 아래 §4 규약)

### 구현 후보 (사용자 예시 + 확장)
| 우선순위 | 도구 | 벤치마크 | 핵심 기능 |
|---|---|---|---|
| 1 | 라이브 퀴즈 | Kahoot | 교사가 문제세트로 게임 생성 → PIN/QR로 학생 입장 → 실시간 동시 출제 → 속도+정답 점수 → 리더보드/포디움. **기존 코스웨어 Problem/CourseProblemSet 재사용** (출제·채점 로직 이미 있음) |
| 2 | 단어장 | ClassCard | 단어 덱(영단어-뜻-예문) CRUD + 엑셀 import → 학습 모드 3종(암기 플래시카드/리콜 4지선다/스펠 타이핑) + 학습 진도·반복(틀린 것 위주) |
| 3 | 보드 | Padlet | 담벼락(보드)에 포스트잇 카드(텍스트/이미지/링크) — 실시간 동시 편집은 **기존 Yjs/Hocuspocus 인프라 재사용** (doc-/deck-/sheet- 패턴에 board- 추가) |
| 4+ | 소도구 모음 | Mentimeter/ClassroomScreen | 실시간 투표·워드클라우드(surveys 재활용 가능), 이름 뽑기 룰렛, 모둠 자동 편성, 타이머/신호등 — 작고 빠른 것들 |

순서는 사용자에게 1문항으로 확인 후 시작 (기본 권장: 라이브 퀴즈 → 단어장 → 보드).

---

## 3. 작업 카드 (Phase별 — 각 Phase 커밋+B배포)

### Phase 0: 카테고리/뼈대 (먼저, 30분)
- `frontend/src/config/admin-menu.ts` — '수업' 카테고리 **다음**에 새 카테고리
  `"업무 및 수업 도구"` (key: `edutools`) 추가. 학생 메뉴는 도구별로 참여 경로만.
- 허브 페이지 `/(admin)/tools/page.tsx` — 도구 카드 그리드 (만든 것 목록 + 새로 만들기).
- 백엔드 모듈 컨벤션: 도구마다 `app/modules/tool_<name>/` (router+permissions+schemas),
  모델 `app/models/tool_<name>.py` + `models/__init__.py` 등록 + **수동 멱등 alembic**
  (autogenerate 금지 아님 — 하되 무관 diff 제거. env.py include_object가 인덱스 drop은 막아줌).

### Phase 1: 라이브 퀴즈 (Kahoot형)
- 모델: `LiveQuizSession(problem_set_id FK, host_id, pin(6자리), status: lobby|question|reveal|ended, current_index, settings)` + `LiveQuizPlayer(session_id, user_id nullable+nickname, score)` + `LiveQuizAnswer(session_id, player_id, problem_id, answer, is_correct, ms_taken, points)`
- 진행 동기화: **폴링 기반으로 시작** (2초 폴링 — 60명 검증 완료된 부하 수준, WS는 v2).
  교사 진행 화면(다음 문제/공개/리더보드) + 학생 참여 화면(PIN 입장 → 보기 4버튼).
- 점수: 정답 기본 1000 × 속도 보정(Kahoot식 `1000*(1 - t/limit/2)`).
- 채점은 기존 `services/courseware_grader.grade_answer` 재사용.
- 참여 경로: `/s/quiz/[pin]` (수강생 인증) — 익명 게스트는 v2.
- 권한: `tools.quiz.host` (교사 default) / 참여는 인증만.

### Phase 2: 단어장 (ClassCard형)
- 모델: `WordDeck(owner_id, title, lang_pair, is_public)` + `WordCard(deck_id, term, meaning, example, order)` + `WordStudyState(deck_id, user_id, card_id, box(라이트너 1~5), last_seen, wrong_count)`
- 엑셀/CSV import(단어,뜻,예문) + 학습 3모드 UI + 진도/오답 위주 반복.
- 드라이브 통합(선택): drive ITEM_TYPES 등록은 v2 — 우선 도구 허브에서만.

### Phase 3: 보드 (Padlet형)
- 모델: `ToolBoard(owner_id, title, course_id nullable, access_mode, settings)` — 카드 데이터는 **Yjs Y.Array** (Hocuspocus `board-{id}`)로 실시간. backend-hocuspocus/auth.ts에 TargetKind "board" 추가 + yjs-snapshot 엔드포인트 (sheet- 패턴 복사).
- 카드: {id, text, color, x?, y?, author_name} — 우선 column/grid 레이아웃(자유배치 v2).

### 각 Phase 공통 마무리
- 클래스룸 연동 (§4) + 알림(필요시) + tsc/pytest/boot + 커밋 + B 배포.

---

## 4. 클래스룸 연동 규약 (도구 → 클래스룸 가져오기)

기존 첨부 시스템에 type을 추가하는 방식 (chatbot 첨부 패턴과 동일):
1. `backend/app/modules/classroom/schemas.py` `Attachment`에 type 추가
   (예: `"live_quiz"`, `"word_deck"`, `"board"`) + `<type>_id` 필드.
2. frontend `AssignmentModal.tsx` `AttachmentItem` + 첨부 버튼/피커
   (ChatbotPickerModal 패턴 — 본인 도구 목록에서 선택).
3. `PostDetailView.tsx` `AttachmentRow`에 렌더러 추가 — 학생 클릭 시 동작 정의
   (live_quiz → 진행 중이면 참여 화면, word_deck → 학습 화면, board → 보드 열기).
4. 학생 접근 권한: 도구 모델에 course 연결이 없으면
   `services/attachment_share.py` 패턴(글 첨부 기반 접근) 참고 또는 도구별 가드.
5. 생기부 수집(선택): `record_writer/collect.py`에 소스 추가하면 도구 활동도 생기부로.

## 5. 재사용 가능한 기존 자산 (먼저 읽으면 좋은 파일)
- 코스웨어: `app/modules/courseware/` (문제·자동채점), `services/courseware_grader.py`
- Yjs 실시간: `backend-hocuspocus/src/auth.ts` + `classroom_sheets/router.py`의 yjs-snapshot 3종
- 피커 패턴: `components/classroom/ChatbotPickerModal.tsx`, `DrivePicker.tsx`
- 첨부 렌더: `components/classroom/PostDetailView.tsx` AttachmentRow
- PIN/QR: `classroom_links`(단축링크·QR 이미 있음 — 라이브 퀴즈 입장에 재사용)
- 멱등 마이그레이션 예시: `alembic/versions/5b2c3d4a9e1f_student_confirmations.py`

## 6. 주의 (이번 세션에서 배운 함정)
- 모델 모듈명 정확히 (`classroom_hwp` 단수 — 오타 한 번에 posts 전체 500 났었음).
  새 코드의 모델 속성·모듈 경로는 **반드시 실행 검증** (py_compile로는 못 잡음).
- alembic autogenerate가 만든 파일에서 무관 drop들 제거 후 적용.
- PowerShell 인라인 따옴표 금지 — 스크립트 파일 경유.
- 사이드바 학생 메뉴는 `frontend/src/config/student-menu.ts`.
