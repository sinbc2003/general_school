# 다음 세션 인계 — "업무 및 수업 도구" 후속

> 사용자가 **"이어서"** 라고 하면 이 문서를 읽고 §3에서 작업을 고른다.
> (갱신: 2026-06-11 — 도구 4종 Phase 0~4 전부 완료·배포됨)

---

## 1. 환경 / 작업 방법 (요약 — 상세는 CLAUDE.md)

- **코드**: WSL `/home/sinbc/general_school` = GitHub `sinbc2003/general_school`
  파일 편집은 `\\wsl.localhost\ubuntu\home\sinbc\general_school\...` 경로로 Read/Edit/Write.
- **운영 서버 B**: `ssh susung@100.92.66.61` — pubedu.com(Cloudflare 터널)으로 서비스 중.
- **배포 절차** (매 단계 커밋 후):
  1. `git add <files> && git commit && git push origin main` (main 직접, PR 안 씀)
  2. B: pull → (alembic 변경 시 `alembic upgrade head`) → hocuspocus 변경 시
     `backend-hocuspocus && npm run build` → frontend 변경 시
     `npm run build` (백그라운드 nohup + /tmp/gs-build.done 폴링) →
     `sudo systemctl restart gs-backend gs-frontend [gs-hocuspocus]` → `/api/health` 200 확인
  3. ⚠️ **PowerShell→wsl→ssh 따옴표 깨짐** → `/tmp/스크립트.sh` 작성 후
     `wsl -d Ubuntu bash -lc 'ssh -o BatchMode=yes susung@100.92.66.61 bash -s < /tmp/스크립트.sh'`
     (배포 스크립트 예시: WSL `/tmp/gs-deploy-{1..4}.sh` — 세션 휘발이므로 필요 시 재작성)
- **검증 루틴**: frontend `bash scripts/check_frontend.sh` (tsc) / backend
  `bash scripts/check_{quiz,wordbook,board}_backend.sh` (alembic+boot+routes) +
  `pytest tests/test_edutools.py tests/test_convention_invariants.py tests/test_storage_security.py`
- **커밋 서명**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## 2. 완료된 것 (2026-06-10~11 세션, 전부 B 배포)

사이드바 '수업' 다음 **"업무 및 수업 도구"** 카테고리 + `/tools` 허브. 도구 4종:

| 도구 | 경로 | 핵심 |
|---|---|---|
| 라이브 퀴즈 (Kahoot형) | 교사 `/tools/quiz`, 학생 `/s/quiz/[pin]` | 코스웨어 문제세트 → PIN/QR 입장 → 2초 폴링 상태머신(lobby→question→reveal→ended) → 속도 점수·리더보드·포디움 |
| 단어장 (ClassCard형) | 교사 `/tools/wordbook`, 학생 `/s/wordbook` | 라이트너 box 1~5, 학습 3모드(플래시/4지선다/스펠), CSV import |
| 보드 (Padlet형) | 교사 `/tools/board`, 학생 `/s/board/[bid]` | Yjs Y.Map("cards") 실시간, hocuspocus `board-{id}`, 컬럼 레이아웃 |
| 수업 소도구 | `/tools/mini` | 이름 뽑기 룰렛·모둠 편성(강좌 명단 재사용)·타이머(WebAudio 비프)·신호등 — 클라이언트 only |

- **클래스룸 첨부 통합**: Attachment type `live_quiz` / `word_deck` / `board` —
  피커 3종 + PostDetailView 렌더러. **강좌 글 첨부 = 학생 접근 권한**
  (단어장 학습 / 보드 카드 쓰기. LIKE prefilter + Python 매칭, attachment_share 패턴).
- **권한**: `tools.quiz.host` / `tools.wordbook.manage` / `tools.board.manage`
  (교사 자동 부여). 학생 참여는 인증 + 가드만.
- **모델/마이그레이션**: tool_quiz(3테이블, `7c4d1e8f2a3b`) · tool_wordbook(3테이블,
  `8e5f2a9b3c1d`) · tool_board(1테이블, `9f6a3b4c5d2e`) — 전부 멱등.
- **테스트**: `tests/test_edutools.py` 13개 (퀴즈 풀플로우·IDOR / 라이트너·CSV·첨부가드 /
  보드 권한 매트릭스·yjs-snapshot 토큰 roundtrip).
- backend-hocuspocus `auth.ts`에 TargetKind `board` 추가 (resourcePath="boards" →
  `/api/classroom/boards/...` — 보드 라우터 prefix가 classroom인 이유).

## 3. 다음 작업 후보 (사용자와 순서 확인)

1. **실시간 투표·워드클라우드 (Mentimeter형)** — `/tools/mini`에 5번째 탭 또는 독립 도구.
   surveys 재활용 또는 라이브 퀴즈 폴링 패턴 복사 (한 문항 즉석 투표 + 막대/워드클라우드).
2. **라이브 퀴즈 v2** — WS 전환(폴링→hocuspocus 또는 자체 WS), 익명 게스트 입장
   (LiveQuizPlayer.nickname 컬럼 이미 있음), 문제별 이미지, 팀전.
3. **단어장 v2** — 드라이브 ITEM_TYPES 등록(휴지통·폴더), TTS 발음(Web Speech API),
   학생 자작 덱 허용 여부 결정.
4. **보드 v2** — 자유배치(x/y 드래그), 이미지/링크 카드, 좋아요, 익명 모드.
5. **생기부 수집 연동** — `record_writer/collect.py`에 도구 활동 소스 추가
   (퀴즈 점수·단어장 진도를 교과세특 수집에).
6. **AUDIT_PROGRESS.md 보류 2건** — course-member 헬퍼 통합, useFetchData 훅.

## 4. 주의 (이번 세션에서 확인된 것)

- 새 도구 모듈 컨벤션: `app/modules/tool_<name>/` + 모델 `app/models/tool_<name>.py`
  + `models/__init__.py` 등록 + 수동 멱등 alembic. 단 **Yjs 쓰는 도구는 라우터 prefix를
  `/api/classroom/<복수형>`으로** (hocuspocus resourcePath 규약).
- 메뉴: 학교가 `/system/menu`에서 카테고리를 저장한 적 있으면 DB 설정이 default를
  덮어 새 카테고리가 안 보일 수 있음 → 그 학교에서 메뉴 관리에서 재추가 안내.
- PowerShell 인라인 따옴표 금지 — 스크립트 파일 경유 (위 §1).
- B 프론트 빌드는 nohup + `/tmp/gs-build.done` 폴링 (SSH 세션 타임아웃 회피).
