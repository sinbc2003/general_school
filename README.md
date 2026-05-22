# General School 통합 플랫폼

학교 자체 서버에 설치해 운영하는 **교사·학생 통합 학교 관리 플랫폼**. 데이터는 학교가
통제 (외부 SaaS 사용 안 함). 노트북 1대로 학생 1300명 + 교사 100명 규모까지 운영 가능.

```
[교사·학생 PC/모바일]
       ↓  http://노트북IP/  (학교 LAN 안에서만)
[학교 노트북 1대 = 서버]
   ├─ Frontend  (Next.js, 3000)
   ├─ Backend   (FastAPI, 8002)
   ├─ Hocuspocus (Yjs WebSocket, 1234)  ← 협업 도구
   ├─ PostgreSQL                       ← 데이터
   └─ backend/storage/                 ← 파일 업로드
```

## 어디서부터 읽을까

| 상황 | 읽을 문서 |
|---|---|
| 처음 보는 사람 — 뭐가 되는지 알고 싶다 | 이 README 아래 "주요 기능" |
| **새 컴퓨터에 개발 환경 설치**하고 싶다 | [SETUP.md](./SETUP.md) |
| **학교에 처음 방문해서 서버 셋업**한다 | [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md) (요약) → [DEPLOYMENT_DAY.md](./DEPLOYMENT_DAY.md) (Day 1 step-by-step) |
| **운영 중 명령 reference** (재시작/로그/백업) | [production/README.md](./production/README.md) |
| **외부 시연** 임시 공개 URL 만들기 | [DEMO.md](./DEMO.md) |
| 학교 정보교사에게 시스템 **설명할 스크립트** | [EXPLANATION_GUIDE.md](./EXPLANATION_GUIDE.md) |
| HWP/한컴 문서 통합 기술 배경 | [docs/HWP_INTEGRATION.md](./docs/HWP_INTEGRATION.md) |
| **AI(Claude) 개발자용** 코딩 가이드 | [CLAUDE.md](./CLAUDE.md) (개발 시 필독) |

## 주요 기능

- **학기 시스템** (NEIS 스타일): 학기마다 학생/교직원 명단 스냅샷, 진급/전출 마법사, 명단·구조 복사
- **권한 시스템**: 5단계 (super_admin / designated_admin / teacher / staff / student), 매트릭스 UI에서 100개+ 권한 키 ON/OFF
- **클래스룸** (Google Classroom 식): 강좌·공지·과제·자료·댓글, 학기별 보관, 즐겨찾기, 카드 커스터마이징
- **협업 도구 5종** (Google Drive/Docs 식):
  - **문서** (TipTap + Yjs, 실시간 동시 편집)
  - **시트** (fortune-sheet + Yjs)
  - **프레젠테이션** (16:9 슬라이드 + Yjs)
  - **설문지** (Google Forms 식 + 단축 링크 + QR)
  - **한컴 문서** (`@rhwp/editor`, 단독 편집)
- **AI 챗봇**: Anthropic / OpenAI / Google 멀티 프로바이더, 교사·학생 분리, 비용 자동 집계
- **학생 포트폴리오**: 성적·수상·논문·상담·모의고사·생기부 + PDF 출력 (8섹션)
- **진로·진학 설계**: 학기 단위 학생 본인 계획
- **개인 드라이브** + **Quota** (역할별 자동 부여): 폴더 시스템 + 휴지통 30일 + AI 정리 사이드바
- **백업 ZIP**: 학교 이동 시 본인 드라이브를 ZIP으로 받아 다른 학교에 복원
- **알림 시스템**: in-app + Browser OS notification (강좌 글, 과제 채점, 댓글, 마감 임박 등 6종 트리거)
- **Google Drive 연동** (선택): OAuth로 본인 Google Drive 보기 + 문서·시트 export
- **인사이동 도구**: 후임자 자료 일괄 이관 + 학교 정책 영구 보존

## 기술 스택 한 줄

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: FastAPI + async SQLAlchemy 2.0 + **PostgreSQL** (dev·운영 모두)
- **협업**: Yjs (CRDT) + Hocuspocus (Node.js sidecar, WebSocket 1234)
- **인증**: JWT + bcrypt + TOTP 2FA + Fernet (API 키 암호화)
- **AI**: Anthropic / OpenAI / Google Gemini (관리자가 API 키 등록 후 사용)

상세 기술 배경: [EXPLANATION_GUIDE.md §3](./EXPLANATION_GUIDE.md) (학교 정보교사용 설명 스크립트)

## 폴더 구조

```
general_school/
├── README.md                # 이 파일
├── SETUP.md                 # 개발 환경 설치 (복붙용)
├── DEPLOY_TO_SCHOOL.md      # 학교 방문 셋업 체크리스트
├── DEPLOYMENT_DAY.md        # 학교 방문 Day 1 step-by-step
├── DEMO.md                  # cloudflared 임시 시연
├── EXPLANATION_GUIDE.md     # 정보교사 설명 스크립트
├── CLAUDE.md                # AI 개발자 가이드 (개발 시 필독)
├── .env.example             # 환경 변수 템플릿
├── backend/                 # FastAPI + SQLAlchemy
│   ├── app/{core,models,modules,services}/
│   ├── alembic/             # DB 마이그레이션
│   ├── scripts/             # 시드, 정리 명령
│   ├── storage/             # 사용자 업로드 (gitignore)
│   └── requirements.txt
├── frontend/                # Next.js
│   └── src/{app,components,lib}/
├── backend-hocuspocus/      # Yjs 협업 서버 (Node.js sidecar)
├── production/              # systemd / nginx 템플릿 + 백업 스크립트
│   ├── README.md            # 운영 reference
│   ├── systemd/             # gs-backend / gs-frontend / gs-hocuspocus
│   ├── nginx/gs.conf
│   └── scripts/{backup.sh,generate-prod-keys.sh}
├── scripts/
│   ├── setup-production.sh  # 학교 노트북 한 줄 셋업
│   └── setup_postgres.sh    # PostgreSQL 설치 + DB·user 생성
└── docs/HWP_INTEGRATION.md
```

## 보안 요약

- 학교 LAN 안에서만 운영 (외부 인터넷 차단 권장)
- 비밀번호 bcrypt 해시 저장
- 민감 데이터(성적·상담·생기부) 접근 시 TOTP 2FA 강제
- 모든 변경은 `audit_logs`에 기록
- LLM API 키 Fernet 암호화 저장
- CORS 화이트리스트 + 로그인 rate limiting
- production 배포 시 `JWT_SECRET` / `ENCRYPTION_MASTER_KEY` / `HOCUSPOCUS_INTERNAL_TOKEN`
  반드시 강한 랜덤으로 교체 (`scripts/setup-production.sh`가 자동 처리)

## 라이선스
비공개 (학교 운영용).
