# 학교 정보교사 설명 가이드

> 이 문서는 신병철 본인이 학교 방문 전 공부하고, 정보교사에게 시스템을 소개할 때 쓰는 스크립트.
> 30분 안에 큰 그림 + 시연까지 끝낼 수 있게 정리.

---

## 0. 한 줄 요약 (엘리베이터 피치)

> "Claude 같은 AI 코딩 도구로 만든 **학교 통합 플랫폼**입니다. 학기 단위로 학생/교사 명단·시간표·과제·동아리·진로/진학 설계·AI 챗봇·생기부 자동 출력까지 한 노트북에서 다 돌아갑니다. NEIS는 그대로 두고, 학교 안에서 자유롭게 쓸 작은 보조 시스템이에요."

---

## 1. 왜 만들었나? (1분)

- NEIS는 강력하지만 **불편한 점**: 메모 / 진로 설계 / 학생 산출물 모으기 / 동아리 자료 / 교사 자료실 등
- 외부 SaaS(클래스팅 등) 쓰면 학교 데이터가 외부로 — 보안 부담
- **학교 안 노트북 1대에 서버 띄워서 LAN 안에서만** 쓰면 데이터 외부 유출 없음
- 학기 끝나면 백업 ZIP 한 번 받으면 끝. 장비 망가져도 새 노트북에 복원

**핵심 가치**: "사교육이 못 하는 공교육의 디지털 인프라" — 학교가 자기 데이터로 자기 분석 함.

---

## 2. 큰 그림 (2분)

```
              ┌─────────────────────────────────────────┐
              │   학교 안 노트북 1대 (서버 역할)            │
              │                                         │
   교실 PC ──→│  Backend (Python FastAPI, port 8002)     │
   교사 노트북─┤  Frontend (Next.js, port 3000)          │
   학생 휴대폰─┤  DB: SQLite 파일 1개 (general_school.db) │
              │  파일 저장: backend/storage/             │
              └─────────────────────────────────────────┘
                            │
                  LAN 내부 IP로만 접속
                  (외부 인터넷에선 막혀있음)
```

- 사용자 PC/모바일은 사이트 주소(`http://192.168.x.x:3000`) 접속
- 서버는 학교 와이파이 LAN 안에서만 동작
- AI 챗봇만 OpenAI/Anthropic/Google API로 외부 호출 (API 키는 서버에 암호화 저장)

---

## 3. 기술 스택 (5분 — 정보교사용 상세)

### 3-1. 한눈에 보기

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (브라우저)                                       │
│    Next.js 14 + TypeScript + Tailwind CSS               │
│    파일 위치: frontend/src/                              │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / HTTP (JSON)
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Backend (Python 서버, port 8002)                        │
│    FastAPI + SQLAlchemy 2.0 (async) + Pydantic          │
│    파일 위치: backend/app/                               │
└─────┬─────────────┬─────────────────────┬──────────────┘
      │             │                     │
      ↓             ↓                     ↓
   SQLite        파일 저장             AI API
   (단일 .db)  (backend/storage/)   (OpenAI/Claude/Gemini)
```

### 3-2. Frontend — Next.js 14 (App Router) + TypeScript + Tailwind

| 구성 | 역할 |
|---|---|
| **Next.js 14** | React 기반 풀스택 프레임워크. 파일 기반 라우팅(`app/page.tsx` = 페이지) |
| **App Router** | 폴더 = URL. 예: `app/(admin)/students/page.tsx` → `/students` |
| **TypeScript** | 모든 코드 타입 명시. 데이터 구조 오타 컴파일 시점에 잡힘 |
| **Tailwind CSS** | `class="bg-cream-100 text-text-primary"` 식 utility CSS. 디자인 통일 쉬움 |
| **lucide-react** | 가벼운 아이콘 라이브러리 (`<Megaphone />`, `<Calendar />` 등) |

**왜 Next.js?**
- 한 사람이 유지보수 → 풀스택 한 곳에서 끝. 별도 라우팅 라이브러리·번들러 설정 X
- Hot-reload — 코드 저장하면 1~2초 안에 화면 반영
- TypeScript 통합 — 타입 안전

**왜 Tailwind?**
- 별도 CSS 파일 안 만들어도 됨. 클래스명만 박음
- `tailwind.config.ts`에 `cream`, `accent` 등 색 한 번 정의 → 전체 통일
- 사용 안 한 클래스는 빌드 시 제거 (PurgeCSS 내장)

**자체 제작 공용 컴포넌트** (`frontend/src/components/ui/`):
- `DataTable` — 정렬·검색·페이지네이션·CSV export 통합
- `Modal`, `ChipInput`, `CsvUploader`, `InlineCell`
- 학생 관리·과제·동아리 6개 페이지가 공유 → 디자인 일관성

---

### 3-3. Backend — FastAPI + SQLAlchemy 2.0 + Pydantic

| 구성 | 역할 |
|---|---|
| **FastAPI** | Python 비동기 웹 프레임워크. 라우터 정의가 데코레이터로 한 줄 |
| **SQLAlchemy 2.0** | Python ORM. 모델 = 클래스, 쿼리 = `select(User).where(...)` |
| **Pydantic** | 요청/응답 자동 검증. 잘못된 JSON 오면 422 응답 자동 |
| **uvicorn** | ASGI 서버 (개발용). production은 gunicorn + uvicorn workers |
| **Alembic** | DB 마이그레이션 도구. 모델 변경 → 자동으로 ALTER TABLE 스크립트 생성 |

**왜 FastAPI?**
- Type hints 그대로 → 자동 검증 + 자동 OpenAPI 문서 (`/docs` 들어가면 스웨거 UI)
- 비동기 (`async def`) → DB·외부 API 호출 동안 다른 요청 처리
- 의존성 주입(`Depends`) — 권한 체크·DB 세션·인증 한 줄로

**예시 코드 (공지사항 라우터)**:
```python
@router.post("/api/announcements")
async def create_announcement(
    body: AnnouncementCreate,                          # Pydantic 자동 검증
    user: User = Depends(require_permission("announcement.post.create")),  # 권한
    db: AsyncSession = Depends(get_db),                # DB 세션
):
    a = Announcement(title=body.title, ...)
    db.add(a)
    await db.flush()
    return {"id": a.id}
```
한 줄 한 줄이 명확. 권한 / DB / 검증이 함수 시그니처에 다 들어있음.

**왜 SQLAlchemy 2.0?**
- Python 진영의 ORM 표준
- 비동기 지원 (`async def list_users()`)
- 모델 = Python 클래스. 관계(외래키)도 코드로 표현
  ```python
  class Assignment(Base):
      id: Mapped[int] = mapped_column(primary_key=True)
      semester_id: Mapped[int] = mapped_column(ForeignKey("semesters.id"))
      title: Mapped[str] = mapped_column(String(255), nullable=False)
  ```

---

### 3-4. DB — SQLite (운영) / PostgreSQL (확장)

| 항목 | SQLite | PostgreSQL |
|---|---|---|
| 형태 | 단일 `.db` 파일 | 별도 서버 |
| 동시 접속 | ~80명 | 무제한 |
| 백업 | 파일 복사 | pg_dump 명령 |
| 설치 | Python 내장 | 별도 설치 필요 |
| 현재 상태 | ✅ 사용 중 | 한 줄로 전환 가능 |

**전환 방법**:
```bash
# .env 파일 한 줄만 변경
DATABASE_URL=postgresql+asyncpg://user:pw@localhost/general_school
```
모델 코드 변경 0줄. SQLAlchemy가 추상화하니까.

**왜 SQLite로 시작?**
- 학교 노트북에 PostgreSQL 설치 부담
- 80명 동접까지 충분
- 백업이 `.db` 파일 1개 복사로 끝남 — 외장 SSD 보관 쉬움

---

### 3-5. 인증·보안

| 구성 | 역할 |
|---|---|
| **JWT (PyJWT)** | 로그인 후 토큰 발급. stateless |
| **Refresh token** | Access token 만료 시 자동 재발급 |
| **bcrypt (passlib)** | 비밀번호 해시 저장 (DB 유출돼도 평문 비밀번호 안 나옴) |
| **TOTP (pyotp)** | Google Authenticator 같은 6자리 OTP. 성적·상담 접근 시 강제 |
| **Fernet (cryptography)** | API 키 대칭 암호화. `ENCRYPTION_MASTER_KEY` 환경변수 기반 |
| **CORS allowlist** | 학교 도메인만 API 호출 허용 |
| **Rate limit** | 로그인 무차별 대입 방어 (메모리 기반, 분당 N회) |

---

### 3-6. AI 챗봇 — 멀티 프로바이더

```
사용자 채팅 입력
    ↓
[chatbot/router.py SSE 스트림]
    ↓
[services/llm/base.py: LLMAdapter 공통 인터페이스]
    ├─ openai_adapter.py    (GPT-4o, gpt-4o-mini)
    ├─ anthropic_adapter.py (Claude Opus / Sonnet / Haiku)
    └─ google_adapter.py    (Gemini Pro / Flash)
    ↓
매 메시지마다 input/output 토큰 + USD 비용 자동 기록
    ↓
[chat_usage_daily 테이블]에 일별/사용자별 집계
```

- 학교가 OpenAI 키든 Anthropic 키든 자기 거 가져와서 등록
- `/system/llm/models`에서 모델별 단가(USD/1M tokens) 수정 가능
- 학생용은 저렴한 모델 강제 (Haiku, gpt-4o-mini, Gemini Flash)

---

### 3-7. 파일 처리 (Python 라이브러리)

| 라이브러리 | 용도 |
|---|---|
| **openpyxl** | Excel(.xlsx) 일괄 import/export (학생 명단·성적 등) |
| **reportlab** | PDF 생기부 자동 생성. 한글 폰트(Windows malgun / mac AppleSDGothic / Linux NanumGothic) 자동 등록 |
| **csv (내장)** | CSV 동아리 배정·성적·수상 일괄 처리 |
| **aiofiles** | 비동기 파일 I/O (학생 산출물 업로드) |

---

### 3-8. 개발 도구 & 워크플로우

| 도구 | 역할 |
|---|---|
| **Claude Code** | AI 페어 프로그래밍. 자연어 → 코드 자동 생성 |
| **Git + GitHub (SSH)** | 매 변경 commit + push. main 브랜치 단일 |
| **TypeScript compiler** | `tsc --noEmit` 매 변경 후 타입 체크 |
| **VS Code / Cursor** | 코드 에디터 (선택) |

**개발 방식**:
1. 신병철이 자연어로 요청 ("공지사항 게시판 추가해줘, 노출 대상 선택 가능하게")
2. Claude Code가 모델 + 라우터 + 페이지 + 메뉴 한 번에 작성
3. 사람이 화면에서 동작 확인 + 색깔·문구 미세 조정
4. `git push origin main` → GitHub 반영 → 학교 노트북에서 `git pull`

**AI 비율**: 약 95% AI 작성, 5% 사람 검수·수정.

---

### 3-9. 배포 & 운영

| 환경 | 도구 |
|---|---|
| **개발 (Windows)** | WSL2 Ubuntu 위 Python venv + Node.js |
| **dev 서버** | uvicorn `--reload` (코드 변경 자동 재시작) |
| **production 권장** | gunicorn + uvicorn workers 4개 + Caddy reverse proxy + HTTPS |
| **외부 시연** | cloudflared (Quick Tunnel) — 가입 없이 임시 URL |
| **원격 접근** | Tailscale (옵션) — 본인 휴대폰에서만 학교 서버 접근 |
| **자동 재시작** | NSSM (Windows 서비스) 또는 systemd (Linux) |

---

### 3-10. 코드 안전망

신병철이 코드 깊이 못 봐도 시스템이 무너지지 않게:

| 안전망 | 동작 |
|---|---|
| **권한 일관성 검증** | 부팅 시 라우터에 박힌 권한 키 vs 모듈 permissions.py 대조. 어긋나면 부팅 RuntimeError |
| **모델 import 강제** | `app/models/__init__.py`에 import 안 된 모델은 백업에서 빠짐. 백업 시점에 모든 테이블 자동 수집 |
| **Alembic 마이그레이션** | DB 스키마 변경 이력 보존. 롤백 가능 |
| **TypeScript 컴파일** | 매 commit 전 `tsc --noEmit` — 타입 오류 차단 |
| **감사 로그(audit_log)** | 모든 권한·민감 데이터 변경 기록. 누가 언제 무엇을 했는지 |

---

### 3-11. 한 줄 요약 표

| 영역 | 기술 | 한 줄 |
|---|---|---|
| Frontend | **Next.js 14 + TypeScript + Tailwind** | 한 사람이 유지 가능한 풀스택 |
| Backend | **FastAPI + SQLAlchemy + Pydantic** | Python 비동기 + 자동 검증 |
| DB | **SQLite → PostgreSQL** | 단일 파일에서 학교 확장 시 한 줄 변경 |
| 인증 | **JWT + bcrypt + TOTP + Fernet** | 4중 안전망 |
| AI | **OpenAI + Anthropic + Google 멀티** | 학교가 키 가져와 등록 |
| 파일 | **openpyxl + reportlab + csv** | Excel·PDF·CSV 자동 처리 |
| 개발 | **Claude Code + Git/GitHub** | 자연어 → 코드 → push |
| 배포 | **WSL2 + uvicorn + Tailscale(옵션)** | 학교 노트북 1대 LAN |

---

## 4. 핵심 개념 3가지 (3분 — 가장 중요)

### 4-1. 학기(Semester) 단위 데이터 격리

- 2026년 1학기, 2학기, 2027년 1학기 ... 학기별로 독립
- **거의 모든 데이터(과제·동아리·연구·시간표·진로 설계·공지 등)에 `semester_id` 외래키 박혀있음**
- 학기 끝나도 데이터 유지 — 다음 학기에도 조회 가능
- 1학기 끝나고 2학기 등록할 때 **체크박스 한 번에 명단·동아리·구조 그대로 복사**

### 4-2. 5단계 권한 (Role + Permission)

```
super_admin > designated_admin > teacher > staff > student
   (최고관리자)   (지정관리자)      (교사)   (직원)  (학생)
```

- **권한 키**: `archive.document.upload`, `assignment.manage.create` 같은 string
- **권한 매트릭스 UI**: 역할마다 100개+ 권한 키 ON/OFF
- 새 기능 추가 시 부팅 자동 체크 — 라우터에 박힌 권한 키와 시드된 권한이 어긋나면 **부팅 실패** (안전망)
- super_admin은 모든 권한 자동 통과. 첫 가입자가 자동 super_admin.

### 4-3. Visibility (학생 데이터 접근 정책)

- 교사가 "모든 학생" 볼지 "자기 반·자기 교과 학생만" 볼지를 설정으로 통제
- 성적·상담 같은 민감 데이터는 visibility 거치는 함수(`assert_can_view_student`) 통과해야 fetch 가능
- 권한 + visibility 이중 체크

---

## 5. 주요 메뉴 (각 1분씩, 총 10분)

### 5-1. 사용자 관리 (`/users`)
- 교사·학생 명단 관리
- 엑셀로 한 번에 import — 학번/이름/이메일/연락처
- 전학생 추가, 기간제 교사 추가/삭제 모두 개별 가능

### 5-2. 학기·명단·동아리 (`/system/semesters`, `/club`)
- 학기 생성 시 **이전 학기 데이터 복사 옵션** — 명단·동아리·학교 구조(학급 수·교과·부서)
- 학생 동아리 배정은 **CSV 한 줄에 학번/이름/동아리명** 업로드
- 학년 진급 / 졸업 처리도 dry-run 검증 후 실행

### 5-3. 시간표 (`/timetable`)
- 관리자가 학기 시간표 등록 (셀 클릭 → 과목/반 입력)
- 교사는 **본인 시간표만 수정** (가끔 바뀌는 경우)
- **개인 일정(회의·면담·행사)** 별도 모달 — 색깔로 그리드에 같이 표시

### 5-4. 공지사항 (`/announcements`)
- 교사·관리자 작성
- **노출 대상**: "모두 (학생 포함)" 또는 "교직원 전용" 선택
- 상단 고정(핀) 가능, 작성자 본인·관리자만 수정·삭제

### 5-5. 대회·과제 (`/contest`, `/assignment`)
- 교사가 대회/과제 등록 → 학생 화면에 자동 노출
- 학생이 PDF 등 제출
- 교사가 검토 → 코멘트 작성
- 학생이 본인 제출물을 **"포트폴리오 노출 ON"** 하면 PDF 생기부에 자동 포함

### 5-6. 동아리·연구 (`/club`, `/research`)
- 학기 단위 동아리. 멤버 JSON.
- 활동/제출물 기록
- 연구 프로젝트는 졸업 후에도 archive로 후배가 참고 (`/s/research-archive`)

### 5-7. 학생 포트폴리오 (`/s/my-portfolio`)
- 학생 본인이 자유로 산출물 업로드 (보고서·발표·이미지 등)
- 4탭: 전체 timeline / 자유 산출물 / 과제 제출물 / 동아리 산출물
- 본인 수정·삭제 가능 (단, 교사 검토 끝난 과제 제출물은 차단)

### 5-8. 진로/진학 설계 (`/s/career`)
- 학생 본인이 **학기 단위 1개 계획** 작성
- 1학기 끝나면 2학기에 새 계획 (또는 이전 학기 베이스로 보완)
- 교사는 학생 상세 → "진로/진학" 탭에서 학생 계획 history 조회

### 5-9. 학생 누적 포트폴리오 (`/students/{id}`)
- 좌측 학생 목록 + 우측 7탭: **누적통계 / 성적 / 수상 / 논문 / 상담 / 모의고사 / 생기부**
- 모든 학년 누적
- 상단 "**PDF 생기부**" 버튼 → 교육부 양식 모방 한글 PDF 즉시 출력
- "CSV" 버튼 → 학생 단일 데이터 묶음 export

### 5-10. AI 챗봇 (`/chat`, `/s/chat`)
- 교사: 자유 모드. 모델/프롬프트 변경 가능
- 학생: 가드레일 시스템 프롬프트 강제 (모델·프롬프트 변경 잠금)
- `/system/llm/...`에서 OpenAI/Anthropic/Google API 키 + 모델 + 단가 설정
- 매 메시지마다 input/output 토큰 + USD 비용 자동 기록 → 사용량 페이지에서 일별/사용자별 집계

---

## 6. 운영 시나리오 (5분)

### 시나리오 A: 학기 시작 (1년에 2번)
1. `/system/semesters` → "학기 생성"
2. 이전 학기 데이터 복사 체크
3. 학생 명단에 변경 있으면 `/users`에서 추가/삭제
4. 동아리 멤버 바뀌면 CSV 업로드
5. 시간표는 관리자가 등록, 교사는 본인 부분 검토

### 시나리오 B: 일상 사용
- 교사: 출근 → 노트북 켜서 backend·frontend 자동 실행 → 본인 시간표·공지·과제 등록
- 학생: 휴대폰으로 학교 와이파이 접속 → 공지·대회·포트폴리오 작성·AI 챗봇

### 시나리오 C: 학기 끝 / 백업
1. `/system/backup` → "전체 백업 다운로드" — ZIP 파일 1개 (DB + 업로드 파일)
2. 외장 SSD에 보관
3. 노트북 망가지면 새 노트북에서 ZIP 업로드 → 자동 복원

### 시나리오 D: 신규 기능 추가
- 신병철이 원격에서 코드 추가 → GitHub push
- 학교 방문일에 `git pull` → backend·frontend 재시작 → 끝

---

## 7. 배포 방식 = "학교 노트북 1대" (3분)

- 인터넷 외부에 노출 안 됨 — LAN 안에서만
- 노트북 절전 끄기 + Wi-Fi 자동 절전 끄기 → 24시간 켜놓음
- 외부에서 접근하려면? Tailscale 같은 VPN으로 본인만 (선택)
- 외부 인터넷 필요한 건 AI API 호출 한 가지

**왜 클라우드 안 쓰나?**
- 클라우드 비용 (월 $20+) → 학교 예산 부담
- 학생 데이터를 외부 서버 두고 싶지 않음
- 학교 안에 노트북 1대면 충분

---

## 8. 보안 (2분)

- 비밀번호 bcrypt 해시 저장
- 민감 데이터(성적·상담) 접근 시 **TOTP 2단계 인증** 필수 (Google Authenticator)
- 모든 변경은 **감사 로그**(`audit_logs`)에 기록 — 누가 언제 무엇을 했는지
- API 키(OpenAI 등) Fernet 암호화 저장 — DB 파일만 봐도 키 평문 안 나옴
- CORS 화이트리스트 + 로그인 rate limiting

---

## 9. 라이브 시연 흐름 (10분)

> **준비**: 학교 도착 후 노트북에서 backend·frontend 띄움. 옆 모니터에 화면 띄움.

### 0:00~1:00 — 로그인
- 첫 가입자가 super_admin이 됨 (NEIS 같은 별도 가입 절차 없음)
- 두 번째부터는 일반 회원가입

### 1:00~3:00 — 사이드바 둘러보기
- 사이드바 카테고리: 업무·나의 영역·수업·학생 관리·AI·관리
- 학생 카테고리에 데이터 격리: super_admin이 "학생 화면 미리보기"로 학생 시점도 미리 봄

### 3:00~5:00 — 학기 + 명단
- `/system/semesters` 학기 생성 (또는 기존 학기 보여줌)
- 이전 학기 데이터 복사 옵션 — 명단·동아리·구조

### 5:00~7:00 — 학생 포트폴리오 + PDF 생기부
- `/students` 학생 1명 선택
- 7탭 (누적 통계 / 성적 / 수상 / ...) 둘러봄
- 상단 "PDF 생기부" 클릭 → 즉시 한글 PDF 다운로드 (8개 섹션)

### 7:00~9:00 — AI 챗봇
- `/system/llm/providers` → API 키 마스킹·테스트 버튼
- `/chat` 또는 `/s/chat` 실제 챗봇 시연
- `/system/llm/usage` 비용 집계 페이지

### 9:00~10:00 — 백업
- `/system/backup` ZIP 다운로드 — 한 번에 모든 데이터 (DB + 파일)
- 새 노트북에 ZIP 올리면 그대로 복원되는 흐름 설명

---

## 10. 정보교사가 물을 만한 Q&A (학습)

**Q1. AI가 짠 코드인데 신뢰할 수 있나?**
- 100% AI 작성 아님. 권한 시스템 / 백업 / DB 마이그레이션 같은 핵심은 사람이 검수
- 부팅 자동 안전망 (권한 키 일관성 / 시드 / 마이그레이션) 박혀있어서 코드 깨지면 부팅 실패로 즉시 발견
- 80% 이상은 AI가 짠 거 + 매 commit마다 사람이 코드 리뷰

**Q2. SQLite로 80명 동접 괜찮나?**
- 페이지 열고 idle: 300+명 OK
- 동시 클릭/저장: 약 30명 한계
- 80명 동접 챗봇 메시지: gunicorn 4 worker로 띄우면 무리 없음
- PostgreSQL로 가려면 `DATABASE_URL=postgresql://...` 한 줄만 바꾸면 됨

**Q3. 신병철이 그만두면 어떻게 운영?**
- 코드는 GitHub에 공개. 학교가 fork해서 자체 운영 가능
- 정보교사가 Python 알면 학교 내 자체 유지 가능
- 또는 다음 Claude Code 인스턴스가 이어받기 가능 (CLAUDE.md에 모든 정책·규칙 문서화)

**Q4. NEIS랑 충돌 안 나나?**
- NEIS와 별개. NEIS 정식 생기부는 그대로 운영
- 이건 "보조 도구" — 학생 활동·포트폴리오·산출물·연구·동아리 같이 NEIS에 안 박는 거 모아두는 용
- PDF 생기부는 NEIS 양식 모방한 보조자료 (정식 아님)

**Q5. 학교 데이터를 학생이 볼 수 있나?**
- visibility 정책 + 권한 매트릭스로 통제
- 학생은 본인 데이터만, 교사는 자기 반·교과 학생만, 관리자는 전체
- 모든 fetch는 권한 + visibility 두 단계 통과

**Q6. 외부 인터넷 차단됐는데 AI 챗봇은?**
- AI만 외부 API 호출. 차단되면 챗봇만 안 됨.
- `/system/llm/config`에서 챗봇 전체 OFF 가능 → 외부 호출 0건
- 학교 내부 정보는 AI 서버에 안 보냄 (학생 채팅은 비식별)

**Q7. 백업 ZIP은 얼마나 큰가?**
- DB 약 1MB (학생 100명 기준)
- 업로드 파일 사이즈에 비례 (포트폴리오·과제 PDF 등)
- 학기 1개 통상 100MB 정도. 1년치 약 500MB. 외장 SSD 1개로 10년 보관 가능

**Q8. 신병철이 코드 못 짜는데 어떻게 AI한테 시켰나?**
- 자연어로 "공지사항 게시판 추가해줘. 교직원/학생 노출 선택 가능하게" → AI가 모델·라우터·페이지·메뉴 한 번에 작성
- 사람은 동작 검증 + 화면 색깔 같은 디테일 조정만
- 코드 보고 "이상한 거 있으면 고쳐줘" 식 협업

**Q9. 이 노트북 망가지면 학교 마비?**
- 5분 안에 복구. 새 노트북에 git clone + 백업 ZIP 업로드 → 끝
- 매일 자동 백업하면 손실 1일 이내

**Q10. 다른 학교에 그대로 쓸 수 있나?**
- 학교명·로고만 환경변수로 바꾸면 그대로 동작
- SETUP.md 따라 30분 설치
- 학교마다 독립 인스턴스 — 데이터 안 섞임

---

## 11. 핵심 메시지 3가지 (마무리)

설명 끝낼 때 반복:

1. **"학교 데이터는 학교가 가진다"** — 외부 SaaS 안 씀
2. **"학기 단위로 깔끔"** — 명단·동아리·시간표 학기 시작에 일괄 복사
3. **"AI가 만들고 사람이 검수"** — 새 기능 추가가 자연어 한 줄로 됨

---

## 12. 신병철 자신이 미리 외워둘 숫자/사실

- 권한 키 정확히: **약 100개**
- 메뉴 카테고리 수: 관리자 7개 / 학생 5개
- 학생 PDF 생기부 섹션: **8개** (인적/학적 / 출결 / 수상 / 자격증 / 창의적체험 / 교과학습 / 독서 / 행동특성)
- 백업 ZIP 안 구성: **manifest.json + data.json (DB) + storage.tar.gz (파일)**
- AI 모델 단가는 USD/1M tokens 단위로 저장. 매 메시지 input/output 토큰 → 비용 자동 계산
- TOTP는 Google Authenticator 같은 OTP 앱으로 6자리 코드
- DB 백업은 외장 SSD 권장. 클라우드 백업은 학교 정책에 따라

---

## 13. 시연 중 실수했을 때 대처

- **"왜 안 되지?"** → "한 번만 새로고침 해볼게요" (`Ctrl+F5`)
- **에러 화면이 뜨면** → "이거 같이 보면서 무슨 에러인지 확인해보면 어떨까요" (학습 기회로 전환)
- **모르는 질문 들어오면** → "좋은 질문이네요. 이건 코드 봐야 정확히 답할 수 있을 것 같아요. 메모해두고 답 드릴게요"
- **AI 챗봇이 이상한 답하면** → "이래서 시스템 프롬프트 가드레일이 중요해요. 실제 학생 화면은 가드 프롬프트가 강제됩니다"

---

> 끝. 이 문서 30분 안에 한 번 훑으면 30분 짜리 설명을 다 할 수 있음.
