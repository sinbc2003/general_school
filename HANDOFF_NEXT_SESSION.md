# 다음 세션 인계 — "업무 및 수업 도구" 후속

> 사용자가 **"이어서"** 라고 하면 이 문서를 읽고 §3에서 작업을 고른다.
> (갱신: 2026-06-12 — 라이브 퀴즈 Kahoot 패리티(직접 출제·이미지·인트로·스트릭)
> 커밋 d99b994+f5a2cfe **B 배포까지 완료** (alembic d8f0a2c4e6b8 적용, health/pubedu 200).)

---

## 0. ✅ B 서버 다운 장애 (2026-06-11 23:30 ~ 06-12 11:41 KST) — 해결됨, 기록 보존

- **타임라인** (journalctl 이전 부팅 + Tailscale LastSeen + wtmp로 판별):
  - 06-11 **23:30 KST**: 네트워크 소실 — `tailscaled Rebind; defIf="", ips=[]`
    (인터페이스 IP 없음) + cloudflared "network is unreachable" 반복.
    **와이파이(공유기/AP) 끊김**이 1차 원인. 머신은 계속 가동.
  - 06-12 **02:07 KST**: 이전 부팅 journal이 여기서 뚝 끊김 + wtmp에 shutdown 기록
    없음("still running") = **비정상 전원 차단** (정전 또는 강제 전원 off).
  - 06-12 **11:41 KST**: 사용자가 전원 켬 → systemd 6서비스 전부 자동 복구
    (gs-backend/frontend/hocuspocus/nginx/postgres/cloudflared 모두 active).
- **함의**: 같은 시각 수성고 A·D도 동시 offline → 학교(또는 설치 장소)
  **망/전원 단위 이벤트**. 재발 시 UPS 또는 BIOS "AC 복구 시 자동 부팅" 설정 검토.
- 부팅 후 자동 복구는 완벽 작동 — 사람 개입 없이 전원만 들어오면 서비스 복귀 확인됨.
- 참고: 와이파이 못 잡으면 모니터 연결해서
  `nmcli device wifi connect susung_5g password susung123`.

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
  3. ⚠️ **PowerShell→wsl→ssh 따옴표 깨짐** → 스크립트 파일 경유:
     `wsl -d Ubuntu bash -lc 'ssh -o BatchMode=yes susung@100.92.66.61 bash -s < /home/sinbc/gs-tmp/스크립트.sh'`
     ⚠️ WSL `/tmp`는 재부팅 시 휘발 — 배포 스크립트는 **`/home/sinbc/gs-tmp/`**에
     (gs-deploy-a.sh = pull+alembic+빌드시작, gs-deploy-b.sh = 빌드대기+재시작+스모크, 이미 있음)
- **검증 루틴**: frontend `bash scripts/check_frontend.sh` (tsc) / backend
  `bash scripts/check_{quiz,wordbook,board,share}_backend.sh` (alembic+boot+routes) +
  `pytest tests/test_edutools.py tests/test_convention_invariants.py tests/test_storage_security.py`
- **커밋 서명**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

## 2. 완료된 것 (2026-06-10~11, 전부 B 배포 — 상세는 CLAUDE.md 해당 세션 섹션)

사이드바 '수업' 다음 **"업무 및 수업 도구"** 카테고리 + `/tools` 허브. 도구 4종:

| 도구 | 경로 | 핵심 |
|---|---|---|
| 라이브 퀴즈 (Kahoot형) | 교사 `/tools/quiz`, 학생 `/s/quiz/[pin]` | 코스웨어 문제세트 → PIN/QR → 2초 폴링 상태머신 → 속도점수·리더보드·포디움 |
| 단어장 (ClassCard형) | 교사 `/tools/wordbook`, 학생 `/s/wordbook` | 라이트너 box 1~5, 3모드(플래시/4지선다/스펠), CSV import |
| 보드 (Padlet형) | 교사 `/tools/board`, 학생 `/s/board/[bid]` | Yjs Y.Map 실시간, 배경 테마 8종, 카드 색·아바타·상대시간 |
| 수업 소도구 | `/tools/mini` | 룰렛·모둠 편성·타이머(비프)·신호등, 백엔드 0 |

핵심 체계 (이후 도구 추가 시 그대로 따를 것):
- **클래스룸 첨부 = 학생 접근 권한**: Attachment type `live_quiz`/`word_deck`/`board` +
  피커 + PostDetailView 렌더러. 도구별 `_has_classroom_attachment` (LIKE prefilter).
- **교사 간 공유 + 사본**: `EduToolShare` + `services/tool_share.py`. 공유=원본 열람만,
  수업 사용은 `POST .../duplicate` 사본. 피커의 "나에게 공유됨" 선택 = 자동 사본 첨부.
- **학기 귀속 정책**: 원본=교사 자산(학기 무관) / 수업 연결=학기 귀속.
  보드는 **활성 학기** 첨부·강좌만 접근(라이브 활동), 단어장은 학기 무관 학습(복습 연속성).
- **내 드라이브 통합**: drive ITEM_TYPES에 `word_decks`/`boards` — 학기 폴더 보관·
  휴지통 30일·F2 이름변경·Ctrl+C 복사·"+신규". 도구 "삭제"=휴지통 이동.
- **도구 UX**: 실행 페이지 진입 시 사이드바 자동 접힘(`useToolFocusMode`), "새 창" 버튼.
- 마이그레이션 체인: `7c4d1e8f2a3b`(quiz) → `8e5f2a9b3c1d`(wordbook) →
  `9f6a3b4c5d2e`(board) → `a2c4e6f8b1d3`(shares) → `b4d6e8f0a2c4`(drive 통합). 전부 멱등.
- 테스트: `tests/test_edutools.py` 19개. routes 639.

## 3. 다음 작업 후보 (사용자와 순서 확인)

1. **실시간 투표·워드클라우드 (Mentimeter형)** — `/tools/mini` 5번째 탭 또는 독립 도구.
   라이브 퀴즈 폴링 패턴 복사 (한 문항 즉석 투표 + 막대/워드클라우드).
2. **라이브 퀴즈 v3** — 익명 게스트 입장(nickname 컬럼 준비됨), 팀전, WS 전환, BGM/효과음.
   (v2 = 직접 출제·문제 이미지·인트로 카운트다운·스트릭·탭 즉시 제출 — 2026-06-12 완료)
3. **단어장 v2** — TTS 발음(Web Speech API), 드라이브 ZIP 백업 포맷(단어장→CSV),
   학생 자작 덱 허용 여부 결정.
4. **보드/화이트보드 잔여 v3** — 화이트보드 다중 페이지·실시간 스트로크 스트리밍
   (현재 pointerup 시 broadcast)·이미지 붙여넣기, 보드 카드 멀티선택.
   (보드 v2 전체 + 화이트보드 도구는 2026-06-11 완료 — CLAUDE.md 3·4차 보강)
5. **생기부 수집 연동** — `record_writer/collect.py`에 도구 활동 소스
   (퀴즈 점수·단어장 진도를 교과세특 수집에).
6. **AUDIT_PROGRESS.md 보류 2건** — course-member 헬퍼 통합, useFetchData 훅.

## 4. 주의 (이번 세션에서 확인된 함정)

- 새 도구 컨벤션: `app/modules/tool_<name>/` + 모델 + 멱등 alembic. **Yjs 도구는
  라우터 prefix `/api/classroom/<복수형>`** (hocuspocus resourcePath 규약).
- **FastAPI 라우트 충돌**: `/decks/{did}` 뒤에 등록한 `/decks/<literal>`은 먹힘
  (path param regex가 [^/]+) → literal 경로는 먼저 등록하거나 최상위로.
- 드라이브 통합 시: 모델에 folder_id/deleted_at/deleted_by/storage_bytes 4컬럼 +
  ITEM_TYPES 등록 + 도구 목록·가드에 deleted 필터 + frontend `_drive-shared.ts` ItemType
  유니온 (DriveContextMenu 등 4개 컴포넌트가 이 타입 공유 — 하드코딩 금지).
- 메뉴: 학교가 /system/menu에서 카테고리 저장한 적 있으면 DB 설정이 default를 덮음
  → 새 메뉴 안 보이면 메뉴 관리에서 재추가.
- pubedu.com(터널) 경유 시 페이지 전환 느림은 집 업로드 대역폭 — 백엔드는 ms 단위.
