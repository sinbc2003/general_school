# General School 통합 플랫폼

## 개요
교사/학생 통합 학교 관리 플랫폼. gshs_teacher + gshs_student를 하나로 병합한 일반 학교용 버전.

## 개발 정책 (AI 개발자 필독)

**이 프로젝트는 Claude Code(또는 동일 계열 AI)로 계속 개발됩니다.**
새 기능 추가 시 아래 보장을 반드시 지킬 것:

### 0. Git 흐름 — main 직접 push (필독)

**사용자(신병철)는 혼자 개발 + 즉시 반영을 선호한다. 다음 원칙:**

- **worktree 만들지 말 것.** Claude Code 기본 격리 모드(worktree)는 본 프로젝트에서 안 씀.
  매 변경은 **main 브랜치 작업 디렉터리에서 직접** 작성.
- **모든 코드 변경 후 자동으로 `git add -A && git commit && git push origin main` 진행.**
  사용자에게 "커밋할까요?" 물어보지 말 것 — 작업 완료 후 바로 push.
- commit 메시지는 한국어/영어 혼합 OK. 작업 의도가 명확하게.
- `.env`, `*.db`, `node_modules/`, `venv/`, `.next/`, `.claude/` 등은 `.gitignore`에 박혀있음 (실수로 커밋 안 됨).
- **비밀번호·API 키는 `.env`에만** — `start-backend.bat` 같은 추적되는 파일에 박지 말 것.
- 큰 작업(여러 단계)은 단계별 commit + push로 추적 가능하게.
- 사용자가 PR 흐름 안 씀 — `gh pr create` 안 함. 그냥 main에 push.

**예외**: 사용자가 명시적으로 "브랜치에서 작업해" 또는 "PR 만들어"라고 할 때만 분기.

### 1. 전체 백업 자동 포함 보장

데이터 백업/복원은 `app/services/backup.py`의 `export_all()` / `restore_all()`가 담당.
SQLAlchemy `Base.metadata.sorted_tables`를 기반으로 모든 테이블을 동적 수집하므로
**일반적으로는 새 테이블/컬럼이 자동으로 백업에 포함**됨. 그러나 다음 규칙을 어기면 누락된다:

- **새 모델 추가 시 반드시 `app/models/__init__.py`에 import** 등록할 것.
  (import해야 `Base.metadata`에 등록됨. 모듈 내부에서 import 안 되면 백업에서 빠짐)
- 모델 파일은 `app/models/<X>.py` 위치에 두고, `Base` 상속.
- **테이블에 file_path 같은 외부 파일 참조 컬럼이 있으면**:
  - 파일은 반드시 `backend/storage/` 하위에 저장 (백업 `storage.tar.gz`에 포함됨)
  - 외부 절대 경로 저장 금지
- `app/services/backup.py`는 수정하지 말 것. 모델 추가만 신경 쓰면 자동 동작.

### 2. Alembic 마이그레이션 일관성

- 모델 변경 후 반드시 `alembic revision --autogenerate -m "변경 설명"` 생성
- 변경 사항을 dev DB에서 `alembic upgrade head`로 검증
- 마이그레이션 파일을 commit에 포함

### 3. 권한 일관성 (이미 RuntimeError로 강제됨)

새 권한 키는 라우터의 `require_permission(...)` 호출과 `app/modules/<X>/permissions.py`에 동시에 정의.
누락 시 부팅 RuntimeError로 실패. 시드 안전망 작동.

### 4. 운영 시나리오 — 학교 자체 서버 설치

- 사용자가 학교 방문 → `git clone` → `SETUP.md` 따라 30분~1시간 셋업
- 자동 배포 없음. 코드 업데이트는 학교가 `git pull` 또는 사용자 재방문
- 학교 데이터는 학교가 통제. 백업도 학교 책임 (외장 SSD 권장)
- 장비 교체 시: `/system/backup`에서 ZIP 받아 새 장비에 그대로 업로드 → 자동 복원

### 5. 보호된 파일 — 큰 변경 전 사용자 확인 권장

- `app/services/backup.py` — 백업 형식 깨면 과거 백업 호환성 잃음
- `app/core/visibility.py` — 학생 데이터 접근 정책 (보안 critical)
- `app/core/permission_registry.py` — 권한 일관성 검증 (부팅 안전망)
- `app/modules/files/router.py` — 파일 다운로드 권한 가드 (보안 critical, 깨지면 학생 개인정보 노출)
- `app/main.py`의 `/storage/branding` mount — favicon 익명 접근 유일 예외 (다른 경로 추가 금지)
- `alembic/versions/` — 과거 마이그레이션 절대 수정 X (새 revision만 추가)
- `app/models/__init__.py` — 모델 등록 (백업 일관성 보장)
- `frontend/src/components/ui/*` — 6개 페이지가 공유, 시그니처 변경 신중
- `frontend/src/lib/api/download.ts` — 모든 파일 다운로드 헬퍼 (직접 `<a href="/storage/...">` 사용 금지)
- `app/core/quota.py` — drive quota 계산·차감·환원 (DEFAULT_QUOTA_BY_ROLE 변경 시 기존 사용자 영향)
- `app/modules/drive/router.py` — 휴지통 30일 정책 + 영구 삭제 quota 환원 (cron과 짝)
- `app/core/notification_scheduler.py` — purge_expired_trash·만료 계정 자동 비활성화 cron
- `app/modules/users/lifecycle.py` — 인사이동 + 자료 후임자 이관 (학교 정책 영구 보존 보장)
- `app/modules/classroom/teachers.py` — `is_course_editor` 헬퍼는 모든 강좌 권한 가드의 SSOT
- `app/modules/google_integration/router.py` — OAuth 토큰 Fernet 암호화, state 1회용 (재사용 금지)
- `app/modules/departments/delegation.py` — DELEGATION_BLOCKED_PREFIXES (escalation 차단, 변경 시 보안 검토)

### 6. 파일 저장·다운로드 규칙 (보안 critical)

**절대 금지**:
- `app.mount("/storage", StaticFiles(...))` 추가 (전체 디렉토리 익명 노출)
- DB에 file 메타 row 없이 `storage/` 하위에 파일만 저장 (가드 통과 불가)
- frontend에서 `<a href={\`${API_URL}${file_url}\`}>` 직접 사용 (인증 우회)

**올바른 패턴**:
- 파일 저장 시 반드시 DB row 생성 (stored_path 또는 file_url 컬럼 채움)
- 새 storage section 추가 시 `app/modules/files/router.py`의 `_GUARDS`에 가드 함수 등록
  (등록 안 하면 403 — 안전한 기본값)
- frontend는 `downloadSecure()` 헬퍼만 사용:
  ```ts
  import { downloadSecure } from "@/lib/api/download";
  <button onClick={() => downloadSecure(file_url, file_name)}>다운로드</button>
  ```
- favicon 같은 익명 접근은 `/storage/branding/`만 허용 (main.py에 명시)

### 7. 새 기능 추가 체크리스트 (필수)

**새 모듈/router 만들 때:**
1. `app/modules/X/__init__.py`, `router.py`, `permissions.py` 생성
2. `app/modules/X/permissions.py`에 `PERMISSIONS = [...]` 정의 (없으면 빈 list)
3. router의 모든 endpoint에 `Depends(require_permission("X.action"))` 적용
4. `app/main.py`에 router import + `app.include_router(...)` 등록

**학생 데이터 다루는 endpoint (`students/{sid}/...` 같은):**
1. 첫 줄에 `await assert_can_view_student(db, user, sid)` **必**
2. visibility 정책 자동 적용 (super_admin/designated_admin 무제한,
   학생 본인만, 교사는 scope=all/scoped에 따라 담임/수업 학년)
3. `test_convention_invariants.py`가 자동 검증 — 누락 시 CI fail

**파일 업로드 endpoint:**
1. `from app.core.upload import validate_upload, POLICY_X`
2. `data = await validate_upload(file, POLICY_X)` (확장자·크기·MIME 검증)
3. 새 파일 타입이면 `app/core/upload.py`에 `POLICY_새이름` 추가
4. **새 storage 디렉토리** 사용 시 `app/modules/files/router.py:_GUARDS`에
   `_guard_새섹션` 등록 (등록 안 하면 다운로드 차단됨 — 안전한 기본값)

**새 모델 추가:**
1. `app/models/X.py` 작성, `Base` 상속
2. `app/models/__init__.py`에 import 등록 (백업 자동 포함 보장)
3. `cd backend && alembic revision --autogenerate -m "add X"`
4. `alembic upgrade head`로 dev DB에 적용 + 검증
5. 학기별 격리 데이터면 `semester_id` FK 추가
6. 파일 컬럼(`file_url`/`stored_path`/`file_path`) 있으면 files/router.py 가드 추가

**민감 권한 (성적·상담·생기부 등):**
- `permissions.py`의 권한 정의에 `requires_2fa=True` + `is_sensitive=True` 추가
- 라우터에서 `await log_action(..., is_sensitive=True)` 호출

**Frontend 새 페이지:**
1. backend 응답 타입은 `frontend/src/types/index.ts` 활용 (UserItem, Semester 등)
2. 파일 다운로드는 `downloadSecure()` 헬퍼만 사용
3. 새 권한 키 사용 시 `<PermissionGate permission="X.action">...` 활용

**자동 강제 (CI에서 잡힘):**
- `tests/test_convention_invariants.py`가 매 CI마다 5가지 invariant 검증:
  1. 학생 sensitive endpoint visibility 가드 호출
  2. UploadFile + validate_upload 일관성
  3. storage section ↔ files/router.py 가드 등록
  4. 모델 file 컬럼 ↔ 가드 함수
  5. sensitive 권한 키워드 2FA 마크
- `tests/test_security_regressions.py` — 권한 escalation, JWT secret, 마지막 super_admin 등
- `tests/test_storage_security.py` — `/storage` 익명 차단 회귀

## 기술 스택
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: FastAPI + async SQLAlchemy 2.0 + PostgreSQL/SQLite
- **인증**: 비밀번호 + JWT + TOTP 2FA

## 실행 방법

### Backend (포트 8002)
```bash
cd backend
pip install -r requirements.txt
# DATABASE_URL은 ../.env에서 자동 로드 (pydantic-settings).
# 본 노트북 dev DB는 PostgreSQL 사용 중 (sqlite 아님). PostgreSQL 미설치 시:
#   cd .. && ./scripts/setup_postgres.sh
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002
```

### Frontend (포트 3000)
```bash
cd frontend
npm install
npm run dev
```

### 가장 빠른 부팅 (Windows)
```
start-backend.bat       # WSL bash 호출 → uvicorn (.env 자동 로드)
start-frontend.bat      # WSL bash 호출 → next dev
start-hocuspocus.bat    # WSL bash 호출 → Yjs 협업 서버 (1234)
```

### "서버키" 사용자 명령 (AI 개발자 필독)

사용자가 **"서버키"**, **"서버 켜"**, **"개발 서버 켜"** 등으로 말하면 **반드시 3개 서버를
모두** 띄워야 한다. 협업 도구(문서·시트·슬라이드·설문)가 Yjs/Hocuspocus에 의존하므로
backend/frontend만 켜면 "연결 끊김"이 표시된다.

| 서버 | 포트 | 명령 (WSL) |
|---|---|---|
| Backend | 8002 | `cd /home/sinbc/general_school/backend && source venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload` |
| Frontend | 3000 | `cd /home/sinbc/general_school/frontend && npx next dev --turbo -p 3000` |
| Hocuspocus | 1234 | `cd /home/sinbc/general_school/backend-hocuspocus && npm run dev` |

전제 조건: PostgreSQL이 떠있어야 함 (`pg_isready -h localhost -p 5432`로 확인).
3개 모두 `run_in_background=true`로 띄우고 포트 listening 확인 후 사용자에게 보고.

### dev 캐시 깨졌을 때 (`Cannot read properties of null (reading 'useContext')` 등)

Next.js dev 서버가 hot reload 시 SSR/CSR bundle의 React reference가 어긋나
"Cannot read properties of null" 에러로 SSR이 깨지는 경우가 있다. 발생 시:

```bash
# 1) frontend dev 종료 (pkill 또는 콘솔 창에서 Ctrl+C)
wsl -d Ubuntu bash -c "pkill -f 'next dev'"

# 2) .next 캐시 삭제
wsl -d Ubuntu bash -c "rm -rf /home/sinbc/general_school/frontend/.next"

# 3) 재시작 — start-frontend.bat 실행 (turbo 미사용, webpack 모드)
```

turbo 모드는 의도적으로 빼두었음 (`start-frontend.bat`에 주석 있음). 빠르지만
캐시 corruption이 잦아 안정성 우선.

### PostgreSQL 부팅 (WSL에서 항상 먼저)
```bash
sudo service postgresql start
```
~/.bashrc에 박아두면 WSL 들어갈 때마다 자동 시작.

## 초기 계정
- **최고관리자**: 첫 가입자가 자동으로 super_admin 부여 (`/auth/setup` 온보딩)
- DB 초기 상태에는 어떤 계정도 없음. 첫 가입 후 두 번째부터는 일반 회원가입.

## 권한 시스템
- 5단계: super_admin > designated_admin > teacher > staff > student
- 새 기능 추가 시 super_admin + designated_admin만 자동 접근 (보수적 기본값)
- 지정관리자는 교사/직원/학생 권한 관리 가능
- system.*, permission.manage.*, user.manage.delete는 super_admin 전용 (`SUPER_ADMIN_ONLY_KEYS`)

### 권한 키 추가/수정 (AI 개발자 필독)

**규칙**: 권한 키는 두 곳에 동시에 존재해야 한다 — 라우터의 `require_permission(...)` 호출 + 그 모듈의 `permissions.py`. 어긋나면 부팅이 RuntimeError로 실패한다.

**새 권한 추가 시:**
1. 라우터에서 사용:
   ```python
   from app.core.permissions import require_permission

   @router.post("/foo")
   async def create_foo(user: User = Depends(require_permission("mymodule.foo.create"))):
       ...
   ```
2. 같은 모듈의 `app/modules/mymodule/permissions.py`에 정의:
   ```python
   PERMISSIONS = [
       {"key": "mymodule.foo.create", "display_name": "Foo 생성", "category": "Foo"},
       # 민감 데이터면 requires_2fa=True, is_sensitive=True 추가
   ]
   ```
3. 부팅 시 자동 시드됨. UI 매트릭스에 자동 노출됨. 추가 작업 없음.

**새 모듈 통째로 추가 시:**
1. `app/modules/mymodule/{__init__.py, router.py, permissions.py}` 생성
2. `app/modules/mymodule/permissions.py`에 `PERMISSIONS = [...]` 정의 (없어도 OK, 권한 0개면)
3. `app/main.py`에서 라우터 import + `app.include_router(mymodule_router)`
4. 모델 추가 시 `app/models/__init__.py`에도 등록 (SQLAlchemy 메타데이터에 잡히도록)

**키 네이밍 규칙**: `{모듈}.{리소스}.{액션}` — 예 `archive.document.upload`, `portfolio.grade.view`. 카테고리는 한글 표시명.

**키 이름 변경 / 삭제 시:**
- 모듈 permissions.py에서 변경 → 부팅 시 시드가 자동 추가/업데이트
- 옛 키는 자동 삭제되지 않음 (역할/사용자 할당이 함께 사라지면 위험) → `WARN: stale 권한 N개` 로그
- 안전 정리: `cd backend && python -m scripts.cleanup_stale_permissions [--dry-run]`

**주요 파일:**
- `app/core/permissions.py` — `require_permission()`, `SUPER_ADMIN_ONLY_KEYS`, `FRONTEND_ONLY_PERMISSIONS`
- `app/core/permission_registry.py` — 자동 수집 + 일관성 검증
- `app/modules/{X}/permissions.py` — 모듈별 권한 정의
- `scripts/seed.py` — upsert 시드
- `scripts/cleanup_stale_permissions.py` — 정리 명령

## AI 챗봇 (트랙 A)

### 구조
- 모델: `app/models/chatbot.py` — LLMProvider, LLMModel, SystemPrompt, ChatSession, ChatMessage, ChatUsageDaily, ChatbotConfig
- 어댑터: `app/services/llm/{openai,anthropic,google}_adapter.py` — 공통 인터페이스 (`base.py`의 LLMAdapter)
- 라우터: `app/modules/chatbot/router.py` — sessions/messages(SSE)/providers/models/prompts/usage/config
- 권한: `app/modules/chatbot/permissions.py` (chatbot.use 등 9개)

### 사용자 흐름
- 교사: `/chat` 페이지 → 자유 모드 (모델/프롬프트 변경 가능)
- 학생: `/s/chat` 페이지 → 가드레일 시스템 프롬프트 강제 (모델/프롬프트 변경 기본 잠금)

### 관리자 설정 (5개 페이지)
- `/system/llm/providers` — Provider별 API 키 (OpenAI/Anthropic/Google), Fernet 암호화 저장, 핸드셰이크 테스트
- `/system/llm/models` — 모델 목록 + USD/1M 단가 (수동 수정 가능)
- `/system/llm/prompts` — 시스템 프롬프트 CRUD (audience: teacher/student/both, is_default)
- `/system/llm/config` — 기본 provider/model, 학생 권한 토글, 메시지/세션 한도
- `/system/llm/usage` — 일별/모델별/사용자별 비용 집계

### API 키 추가 워크플로
1. `/system/llm/providers`에서 API 키 입력 → 저장 → "연결 테스트"
2. 활성화 토글
3. `/system/llm/config`에서 교사/학생 기본 모델 지정
4. 사용자가 `/chat` 또는 `/s/chat`에서 새 대화 → 자동으로 기본 모델로 세션 생성

### 비용 추적
- 각 메시지마다 input/output 토큰 + USD 기록 (LLMModel 단가 기준)
- `chat_usage_daily`에 사용자×일×provider×model 집계
- 예산 한도 없음 (관리자가 사용량 페이지에서 모니터링)

## 누적 포트폴리오 (트랙 B)

### 학생 상세 (`/students/[id]` 통합 — 좌측 학생 목록 + 우측 7탭)
- 7탭: 누적 통계 / 성적 / 수상 / 논문 / 상담 / 모의고사 / 생기부
- 상단 "PDF 생기부" 버튼 → 생기부 양식 모방 PDF 다운로드 (ReportLab)
- 상단 "CSV" 버튼 → 학생 단일 데이터 모든 type 묶음 CSV 내보내기

### CSV 일괄 업로드 (`/students/import`)
- 5종 데이터 (grades/awards/mockexam/counseling/records) 자체 양식
- 템플릿 다운로드 → Excel 편집 → dry-run 검증 → 실행
- 실패 행은 행 번호 + 에러 표시
- 양식 정의: `app/services/portfolio_io.py`의 `CSV_TEMPLATES`

### 학년 진급 / 졸업 (`/students/cohort`)
- 일괄 진급 (1→2, 2→3): `User.grade` 변경
- 졸업 처리: `User.status = "graduated"` (데이터 모두 보존)
- 졸업생 목록 + AdmissionsRecord 매핑 조회
- 항상 dry-run 먼저, 영향 학생 수 확인 후 실행

### 누적 통계 API
- `GET /api/students/{sid}/stats` — 학기별 평균 추이, 수상 카테고리/년도별, 모의고사 등급 추이
- `GET /api/students/{sid}/timeline` — 모든 활동 시간순 통합

### PDF 생기부
- `GET /api/students/{sid}/report.pdf` — 8개 섹션 (인적/학적/출결/수상/창의적체험/교과/모의고사/논문/행동특성)
- 한글 폰트 자동 등록 (Windows: malgun, mac: AppleSDGothic, linux: NanumGothic)
- ReportLab Platypus 기반

## 운영 / 배포 (production 전환 가이드)

### 현재 dev 설정의 한계
- **uvicorn single worker + `--reload`**: dev용. 동시 접속 30명까지가 안전선
- **SQLite**: 단일 파일 lock. write 동시성 약함
- **Next.js dev 모드**: `next dev --turbo`는 메모리 누수 + HMR 부하. production X
- **PDF 생성 (ReportLab)**: 동기 + CPU-bound. 한 명이 PDF 누르면 200~500ms 다른 요청 멈춤

### 80동접 안정화 — 30분 작업
production 전환 시 아래 4가지 적용 권장:

```bash
# 1) Backend: gunicorn + uvicorn worker 4개
pip install gunicorn
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8002

# 2) SQLite WAL 모드 (PG 전환 전 임시 — write 동시성 향상)
# core/database.py init_db()에:
#   await conn.exec_driver_sql("PRAGMA journal_mode=WAL;")

# 3) Frontend production 빌드
cd frontend && npm run build && npm start

# 4) PDF/CSV 같은 동기 + CPU-bound는 asyncio.to_thread로 감싸거나 background queue
```

### 학교 단위 운영 시 권장
- **PostgreSQL 전환**: `DATABASE_URL=postgresql+asyncpg://...` 한 줄만 바꾸면 됨 (모델은 SQLAlchemy 그대로)
- **Caddy reverse proxy**: HTTPS 자동, gzip, static 캐시 (학교 LAN 내부면 HTTP도 OK)
- **systemd / NSSM**: 자동 재시작
- **DB 백업 자동화**: pg_dump 매일 → 외장 SSD/Tailscale 공유 스토리지
- **장비 권장**: 노트북(발열·슬립·SSD 수명) 비추, mac1/mac2 같은 데스크톱 또는 24/7용 mini PC

### LLM 비용 통제
- 학생용은 저렴한 모델 강제 (Haiku, Gemini Flash, gpt-4o-mini)
- `/system/llm/config`에서 `student_can_change_model=false` 유지
- `/system/llm/usage`로 매주 모니터링
- 80명 매일 챗봇 사용 시 월 $30~100 예상 (모델/사용량에 따라)

### 동시 접속 추정 (현재 dev 설정 vs 위 4가지 적용 후)
| 시나리오 | dev 그대로 | 4가지 적용 후 |
|---|---|---|
| 페이지 열어두고 idle | 80명 OK | 300명+ |
| 평범한 클릭/저장 | 30명 한계 | 150명 안전 |
| 80명 동시 챗봇 메시지 | 큐 적체 | 무리 없음 |
| PDF 생성 동시 5건 | 다른 요청 1초+ 멈춤 | 영향 없음 |

## 주의사항
- 원본 코드(gshs_teacher, gshs_student) 절대 변경하지 않기
- OneDrive .next 캐시 이슈: .next 폴더에 System+Hidden 속성 설정
- OneDrive에서 uvicorn `--reload`가 변경 감지 누락하는 경우 있음 → 재시작은 reload 빼고 실행 권장
- 민감 데이터(성적, 상담 등) 접근 시 2FA 필수
- 라우트 path 충돌 주의: `/api/users/{user_id}` 같은 1세그먼트 패턴이 있으면 추가 액션은 `/_action/...` 같은 다세그먼트 prefix로 등록 (이미 적용: `/_cohort/promote`, `/_io/csv-template/{type}`)
- LLM API 키는 절대 코드/로그에 평문 출력 금지 (mask_secret 사용)
- ENCRYPTION_MASTER_KEY는 production 배포 시 반드시 강한 랜덤 키로 교체 (현재는 "change-this-in-production" 기본값)

## 백업 시스템 (자동 포함 보장)

`/system/backup` 페이지 — super_admin 전용. 전체 데이터 ZIP 다운로드/복원.

**자동 포함 규칙**:
- DB 모든 테이블 → `app/services/backup.py`의 `export_all()`이 `Base.metadata.sorted_tables`로 수집
  - 새 모델은 **반드시 `app/models/__init__.py`에 import** (안 하면 백업에서 빠짐)
- `backend/storage/` 디렉터리 → tar.gz로 포함 (사용자 업로드 파일 안전)
  - 파일 저장 시 반드시 `storage/` 하위에 (외부 경로 X)
- manifest.json — alembic revision, 날짜, 학교명, 테이블별 행수

**복원 안전망**:
- 외래키 순서로 wipe → insert (트랜잭션)
- alembic revision 불일치 시 경고 (자동 차단 X, 사용자 결정)
- 백업에만 있는 테이블·컬럼은 안전 무시 (downgrade 안전)
- 복원 후 token 무효화 — 자동 로그아웃

**새 기능 추가 시 백업 자동 포함 체크리스트**:
1. 새 모델 → `app/models/__init__.py`에 import 추가 ✅
2. 파일 저장 경로는 `backend/storage/` 하위 ✅
3. Alembic 마이그레이션 생성 (`alembic revision --autogenerate`) ✅
4. (자동 처리 안 되는 외부 의존성은 없는지 확인)

`app/services/backup.py`는 모델 정보를 모르고 메타데이터로만 동작하므로 새 모델/컬럼이 자동 반영됨.

---

## 최근 세션 변경사항 요약 (새 Claude 세션용)

> 새 세션이 빠르게 catch-up할 수 있게 정리. 코드 보지 말고 여기 먼저 읽을 것.

### DB
- **PostgreSQL 전환 완료** (2026-05-14). dev/운영 모두 PostgreSQL.
- 자동화: `scripts/setup_postgres.sh` (설치+DB생성), `backend/scripts/migrate_sqlite_to_postgres.py` (데이터 이전)
- `.env`의 `DATABASE_URL=postgresql+asyncpg://app:xxx@localhost:5432/general_school`
- `start-backend.bat`은 DATABASE_URL 명시 안 함 (.env 자동 로드 — 비밀번호 git 노출 방지)
- 가이드: `POSTGRES_SWITCH.md`

### 모듈 — 제거된 것 (코드도 삭제)
- **community** (커뮤니티 + 랭킹) — 모델·라우터·페이지 모두 제거. DB 테이블은 보존.
- **meeting** (협의록) — 모델·라우터·페이지 모두 제거. DB 테이블은 보존.
- **papers** 메뉴만 사이드바에서 제거. backend 라우터/모델은 keep (재활성화 가능).
- **데이터 검색** 카테고리 제거.

### 모듈 — 추가된 것
- **announcement** (공지사항)
  - `app/models/announcement.py`: Announcement (audience: all|staff, is_pinned, author_id)
  - `app/modules/announcement/`: router + permissions (announcement.post.create/edit/delete/view)
  - Frontend: `(admin)/announcements/`, `(student)/s/announcements/`
  - 메뉴: admin "업무" 카테고리 + student "홈" 카테고리

### 학기 단위 데이터 격리 강화
- POST `/api/timetable/semesters` 신규 옵션: `copy_from_semester_id` + `copy_enrollments/clubs/structure`
  → 1학기 끝나고 2학기 생성 시 명단·동아리·학교 구조 한 번에 복사
- 학생 진로 설계는 **학기 단위 단일 계획** (StudentCareerPlan.semester_id 추가).
  GET/PUT `/api/me/career-plans/active` (학기 1개, 언제든 수정)
  → 기존 다중 연도 모드에서 변경됨

### 시간표 (Timetable)
- `TimetableEntry.entry_type` 추가: `class | meeting | consultation | event | other`
- `TimetableEntry.note` 추가
- 본인 개인 일정 CRUD: `GET/POST/PUT/DELETE /api/timetable/my-events` (회의/면담/행사)
- 단일 PUT: `PUT /api/timetable/entries/{eid}` — 본인 entry는 교사도 수정. admin은 모든 entry.
- Frontend: 시간표 페이지 우상단 "내 개인 일정" 버튼 → 모달.
  - 그리드 셀에 entry_type 별 색 (회의=purple, 면담=orange, 행사=pink)
  - 교사는 본인 셀만 클릭 편집. 다른 교사 셀은 disabled.

### 동아리 학생 일괄 배정
- CSV import: `POST /api/club/_assignments/import` (학번/이름/동아리명)
- 템플릿: `GET /api/club/_assignments/csv-template`
- Frontend: `(admin)/club/page.tsx` 우상단 "학생 일괄 배정" 버튼 → 모달 (`components/admin/ClubAssignmentModal.tsx`)

### 학생 본인 데이터 CRUD 추가
- `DELETE /api/me/assignment-submissions/{id}` — 본인만, 교사 검토 전만
- `PUT /api/me/club-submissions/{id}` — 본인만, 제목·유형 수정
- `DELETE /api/me/club-submissions/{id}` — 본인만
- Frontend `/s/my-portfolio`에 수정·삭제 버튼 추가

### 학생 포트폴리오 통합
- `/s/my-portfolio` 4탭: 전체 timeline / 자유 산출물 / 과제 제출물 / 동아리 산출물
- `AssignmentSubmission.show_in_portfolio` 컬럼 추가 → 학생이 토글하면 PDF 생기부·공개 갤러리 자동 포함
- 새 endpoint: `GET /api/me/all-activities` (통합 timeline), `/assignment-submissions`, `/club-submissions`
- PDF 생기부 (`report_pdf.py`)에 6-3/6-4/6-5 섹션 추가 (자유 산출물·과제 제출·동아리 산출)

### 사이드바 / UI
- `AdminSidebar`가 학생일 때 `studentMenu` + `categories.student` 사용 (role 분기)
- super_admin이 `/s/*` 경로 가면 자동 학생 사이드바 (미리보기 모드 + "관리자로 돌아가기" 링크)
- `student-area` (학생 화면 미리보기 토글) children은 studentMenu에서 자동 매핑
- 사이드바 scrollTop 보존 (sessionStorage, role별 key)
- 모든 admin 카테고리 default 펼침 (layout 전환 시 재마운트돼도 토글 유지)
- `student-area` parentActive 자동 펼침 비활성화 (다른 메뉴와 path 겹쳐 혼선 방지)

### 색상 / 디자인
- 옅은 파란색 → 따뜻한 크림 톤 일괄 치환 (43곳)
  - bg-blue-50 → bg-cream-100 (#f5f1e7), border-blue-100/200 → border-cream-200/300
- `tailwind.config.ts`에 cream-50~900 팔레트 추가
- 사이드바 우측 경계 box-shadow (claude.ai 스타일 layered shadow)

### 자동 권한 부여 (Lifecycle)
- backend 부팅 시 `scripts/grant_default_roles.py` 자동 실행 (멱등)
- 새 권한 키 추가 → backend 재시작만으로 teacher/staff/student에 자동 부여
- 수동 `python -m scripts.grant_default_roles` 실행 불필요

### Batch Script (Windows)
- `cd /d` → `pushd` (UNC 경로 자동 매핑)
- 한글 REM 주석 → 영문 (CP949/UTF-8 mismatch 회피)
- 줄바꿈 LF → CRLF (cmd 파서)
- `.gitattributes`에 `*.bat/*.cmd/*.ps1 text eol=crlf` 강제
- backend/frontend bat 모두 `wsl -d Ubuntu bash -c "..."` 패턴 (UNC 이슈 회피)

### 데모용 (학교 방문 시연)
- `demo-tunnel.bat` — cloudflared Quick Tunnel로 임시 trycloudflare URL 발급
- `DEMO.md` — 시연 절차 + 보안 주의 + 동작 원리
- `frontend/next.config.js`에 `/api/*` → backend rewrites (BACKEND_PROXY_URL env 옵션)

### 메뉴 이름 변경
- "선배 연구 자료" → "**과거 연구 자료**" (UI + permission display_name)
- "공개 산출물 갤러리" → "**학생 산출물 갤러리**"

### 문서
- `EXPLANATION_GUIDE.md` — 학교 정보교사 30분 설명 스크립트 + Q&A 10개 + 기술 스택 상세

### 통계 (2026-05-13 ~ 05-14)
- Commit 약 30개
- 새 파일: announcement (모델·라우터·페이지), 학기 복사, 동아리 CSV, 진로 학기별, 시간표 개인일정 등
- 삭제 파일: community/meeting/papers 일부 (1500줄+ 정리)

---

## 2026-05-19 세션 — 인프라 강화 + 보안 critical fix

### Pydantic schema 마이그레이션 완료
- 모든 dict body endpoint를 Pydantic schema로 변경 (총 64개)
- 12개 모듈에 `schemas.py` 추가 또는 확장: portfolio, student_self, admissions, contest, challenge, research, announcement, feedback, pipeline, chatbot, auth, users
- 의도적 dict 유지 2건: portfolio `_generic_update` 팩토리, chatbot config (CONFIG_KEYS 화이트리스트)
- OpenAPI 문서 자동 풍부화 + 입력 검증 강화

### 큰 파일 분할 — sub-router 패턴
**Backend** (분할 전 → 분할 후):
- `portfolio/router.py` 698 → router 23 + crud 351 + analytics 126 + io 94 + pdf_report 84 + teacher_views 109
- `student_self/router.py` 669 → router 22 + _helpers 44 + artifacts 167 + career_plans 166 + discovery 103 + submissions 259
- `auth/router.py` 587 → router 24 + _helpers 43 + registration 113 + login_flow 341 + session 129 + 기존 two_factor 111 + devices 98
- `users/router.py` 630 → router 24 + _helpers 60 + crud 233 + sessions 121 + bulk 170 + cohort 112
- `system/router.py` 574 → router 31 + audit 132 + menu 135 + branding 116 + backup 226
- `chatbot/admin.py` 471 → admin_providers 111 + admin_models 132 + admin_prompts 114 + admin_config 65 + admin_usage 114

**Frontend**:
- `(student)/s/my-portfolio/page.tsx` 705 → 61 + _shared 92 + 4개 탭 컴포넌트
- `components/chat/ChatInterface.tsx` 700 → 495 + 3개 sub-component + _chat-styles
- `(admin)/system/backup/page.tsx` 584 → 272 + BackupSchedule 327
- `(admin)/archive/problems/page.tsx` 512 → 263 + _shared 84 + ProblemFormModal 217
- `(admin)/users/page.tsx` 482 → 322 + CsvBulkImportModal 174

**보류 (정책상 분할 안 함)**:
- `(admin)/students/_tabs.tsx` 833줄 — 파일 헤더 명시 정책("탭당 200줄 이상일 때만 분리"). 9개 탭 모두 ~100줄 준수.
- `services/report_pdf.py` 476줄 — 단일 `generate_student_pdf` 함수 + 섹션별 헬퍼 (이미 분리). 더 쪼개도 큰 이점 없음.

### 프론트엔드 공유 타입
- `frontend/src/types/index.ts` 신규 — Semester, UserItem, UserInfo, Enrollment, Role 등 6개 공통 타입
- 5+ 페이지에서 중복 선언된 인터페이스 통합

### 테스트 인프라 강화 (37 → 90)
신규 테스트 파일:
- `test_student_visibility.py` (11) — `assert_can_view_student` 매트릭스: admin 무제한, 학생 본인만, 교사 scope=all/scoped, homeroom·teaching_grades 매칭
- `test_backup_roundtrip.py` (6) — export ↔ restore 라운드트립, RestoreError 케이스, Base.metadata 자동 포함 보장
- `test_cohort_lifecycle.py` (15) — 진급/졸업 + 마지막 super_admin 보호 (`_count_active_super_admins`, `_ensure_not_last_super_admin`)
- `test_storage_security.py` (21) — `/storage` 익명 노출 차단 + 모듈별 ownership 가드

모두 `pytest.mark.security` 마킹 → CI 보안 게이트.

### 🚨 보안 critical fix — `/storage` 익명 노출 차단

**발견된 취약점** (231ddc3 이전):
- `app.mount("/storage", StaticFiles(...))`로 인해 학생 비공개 산출물·과제 제출물·연구 자료·백업 ZIP까지 익명 GET 200 OK
- 외부인이 file_url 추측만 하면 학생 개인정보 전체 노출 가능
- 실제 익명 다운로드 확인됨

**수정**:
- `/storage` 전체 mount 제거. `/storage/branding/*` 만 익명 mount (favicon SSR 필요)
- 신규 `app/modules/files/router.py`: `/api/files/storage/{path:path}` 인증 + section별 가드
  - `artifacts`: owner OR is_public OR admin OR teacher+visibility
  - `assignments`: AssignmentSubmission.user_id 본인 OR visibility 통과 교사 OR admin
  - `research`: project advisor/member/submitter OR admin
  - `documents`: archive.document.view 권한
  - `club`: ClubSubmission.author_id 본인 OR Club advisor/member OR admin
  - `auto-backups`: super_admin 전용
  - 알 수 없는 section: 403 (안전한 기본값)
  - DB lookup으로 file_url 매칭 없으면 404 (path 추측 차단)
- Path traversal 다중 방어 (`..`, 절대경로, 정규화 후 storage 외부 차단)

**Frontend**:
- `lib/api/download.ts` 신규 — `downloadSecure(file_url, filename)` 헬퍼
  - `/storage/x` → `/api/files/storage/x` 자동 변환
  - Authorization 헤더 자동 주입, fetch + blob + a.click() 패턴
- 4개 페이지의 `<a href>` → `<button onClick={downloadSecure(...)}>`:
  - `(student)/s/my-portfolio/_components/ArtifactsTab` (학생 본인 자유 산출물)
  - `(student)/s/my-portfolio/_components/ClubsTab` (학생 본인 동아리 산출물)
  - `(admin)/students/_tabs` (교사가 학생 산출물 보기)
  - `(admin)/students/artifacts-gallery` (공개 갤러리)

### 보안 점검 결과 (모두 OK)
- IDOR: 학생 → 다른 학생/admin endpoint 모두 403 가드 작동
- 챗봇 세션 isolation: DB 가드 작동 (다른 사용자 세션 메시지 주입 차단)
- Path traversal (업로드): basename + 확장자 화이트리스트
- SQL injection: ORM 전용, raw SQL 0
- CORS: 환경변수 화이트리스트
- CSRF: HttpOnly + SameSite=Lax cookie

### 통계 (2026-05-19)
- Commit 약 25개
- 테스트: 37 → 90 (+53)
- backend `app/` 약 18000줄 동일 (refactor 위주, 신규 코드 적음)
- frontend production build OK, backend boot OK (289 endpoint)
- alembic schema ↔ 모델 일치

### AI 개발자 모듈 강화 (2026-05-19 후반)

기존 `ai_developer` 모듈을 "코딩 모르는 관리자도 사용 가능"하게 확장.

**워크플로우** (피드백 → 코드 적용):
1. 사용자가 우측 하단 버튼 → 건의/오류 보고 (`/api/feedback`)
2. 관리자가 `/system/feedback`에서 "🤖 AI 개발 요청" 클릭
3. → `POST /api/feedback/{fid}/ai-request` (page_url + 작업지시 자동 prompt 생성, 멱등)
4. → `/system/ai-developer` 페이지로 자동 이동 (DevRequest 자동 채워짐)
5. 관리자가 "AI 생성" 클릭 → Claude API 호출 (CLAUDE.md + 관련 모듈 코드 자동 첨부)
6. AI 응답: 변경할 파일 목록 + diff 미리보기
7. 관리자가 "승인" → backup → apply → 자동 회귀 테스트 → fail 시 자동 rollback

**핵심 안전망**:
- `BLOCKED_FILES` — auth/permissions/core 등 인증·권한 모듈 + CLAUDE.md 자기 자신 (AI가 자기 규칙 못 바꿈)
- `BLOCKED_PREFIXES` — alembic/, .env, .github/, .claude/
- `ALLOWED_DIRS` 화이트리스트 — frontend/src/app/, components/, lib/, backend/app/modules/, models/
- 적용 후 자동 회귀 테스트: pytest 보안 마킹 + smoke + convention invariants (120초 timeout)
- 회귀 발생 시 자동 rollback (create→delete, modify→restore from in-memory backup)
- 모든 적용/거부/실패 audit_log (is_sensitive=True)

**권한 확장**:
- 이전: `require_super_admin()` 만
- 변경: `require_permission("system.ai_developer.use")` (requires_2fa, is_sensitive)
- super_admin은 자동 pass, 지정관리자(개발 담당)도 권한 부여 시 사용 가능

**AI 컨텍스트 자동 주입**:
- `_load_project_guide()` — CLAUDE.md 전문(최대 80KB) 자동 첨부
- `extract_referenced_files()` — prompt에 "X 모듈" 키워드 자동 매칭 (21개 알려진 모듈)
  → 매칭 시 router.py/schemas.py/permissions.py 자동 첨부 (최대 15개 파일)
- AI가 학교 코드의 컨벤션·보안 규칙·확장 패턴 모두 알고 작업

**모델 선택**: 기본 `claude-sonnet-4-20250514`. `/api/ai-developer/models` 로 사용 가능 모델 목록 조회.

### 통계 (2026-05-19 후반)
- Commit 약 35개 (전체 세션)
- 테스트: 37 → 95 (+58) — convention invariants 5개 추가
- 새 모듈: `files/` (인증된 파일 서빙), `ai_developer/permissions.py`
- 새 기능: 피드백→AI 통합, CLAUDE.md 컨텍스트 자동 주입, 자동 회귀+rollback
- 안전망: 보안·확장 invariant 모두 CI에서 자동 검증

### 추가 작업 (2026-05-19 마감 직전)

**파일명 정규화** (`app/core/filename_normalize.py`):
- 한국 학교 표준 `{snum5}=10101` 변수 (학년1+반2+번호2)
- `{class2}`, `{number2}` zero-pad 변수
- Assignment에 `filename_template` 컬럼 — 학생 업로드 시 자동 적용
- 실시간 미리보기 (frontend + backend)

**클래스룸 MVP** (`app/modules/classroom/`):
- 모델: Course / CourseStudent / CoursePost
- 핵심: 학기 enrollment의 `teaching_classes × teaching_subjects` 자동 강좌 생성
- 학급 단위 강좌는 학생 자동 등록, 선택과목은 학번 일괄 입력 (한국 5자리)
- 권한 4개: `classroom.course.manage/view`, `classroom.post.write/view`
- frontend 4 페이지: admin 목록/상세, student 목록/상세

**📄 인수인계 문서**: `HANDOFF_CLASSROOM_TOOLS.md`
- 다음 단계 계획 — 협업 문서 (Yjs+TipTap+Hocuspocus) + 설문지 + 단축 링크 + QR 코드
- Phase A~F 단계별 작업 카드, 의존성, 안전망 체크리스트
- **새 세션이 self-contained로 작업 시작 가능** (CLAUDE.md + HANDOFF만 읽으면 OK)
- 결정 사항: 스택 선택 이유, 데이터 모델, 권한 매트릭스, Hocuspocus 운영 절차

### 통계 (전체 세션 마감)
- Commit: 40개
- 테스트: 121/121 (filename_normalize +26, 기존 95)
- 새 모듈: files, ai_developer 강화, classroom, **인수인계 문서**
- 새 핵심 헬퍼: filename_normalize (render/preview/ensure_unique), downloadSecure
- 자동화: convention invariants 5종, AI 회귀 테스트+rollback
- alembic migrations: 2개 추가 (assignment.filename_template, classroom 3 테이블)

---

## 2026-05-20 세션 — 협업 슬라이드 + 1400명 1년 production 준비

### 협업 프리젠테이션 (Phase P1~Q3 완성)
- **모델**: `app/models/classroom_slides.py` — ClassroomPresentation / ClassroomSlide / PresentationMember
  - Y.Doc 단위 deck (documentName=`deck-{id}`), slide마다 fragment(`slide-{sid}`)
  - access_mode (course_members | specific_users | link_public), settings JSON (theme_id 등)
- **모듈**: `app/modules/classroom_slides/` (sub-router 패턴) — crud / slides / members / hocuspocus
- **권한**: `classroom.deck.create/view/edit`
- **Hocuspocus 통합**: `backend-hocuspocus/src/auth.ts` extractTarget로 doc/deck 둘 다 지원,
  storage URL은 `/api/classroom/{docs|decks}/{id}/yjs-snapshot`
- **Frontend**:
  - `components/decks/DeckEditor.tsx` — 좌 썸네일 list + 우 active slide editor, deck 단위 1개 provider
  - `components/decks/SlideEditor.tsx` — 16:9 캔버스 + 회색 스테이지 (Google Slides 식)
  - `components/decks/PresentMode.tsx` — 풀스크린 발표 모드 (좌우키/space/esc)
  - `components/decks/ThemePicker.tsx` — 8종 디자인 테마 선택 모달
  - `components/decks/themes.ts` — PPT-019 프로젝트 8개 디자인 CSS 변환
    (Minimal, Monochrome, Seminar, Academic, Vivid, Blackboard, Notebook, Modern Grid)
  - `components/decks/slide-canvas.css` — 슬라이드용 폰트 사이즈 (h1 = clamp(28~56px)),
    container query(cqw/cqh)로 캔버스 폭/높이 자동 맞춤
- **페이지**: `(admin)/classroom/[cid]/decks/{,[did]/{,present}}`, 학생 `(student)/s/...` 미러
- alembic migration: classroom_slides 3개 테이블

### YouTube / 링크 OG 미리보기 (Phase Q2+Q3)
- TipTap @tiptap/extension-youtube 추가 (CollabEditor + SlideEditor + PresentMode 모두)
- `components/docs/LinkCardExtension.ts` — 커스텀 Node, `setLinkCard` 명령으로 OG 메타 카드 삽입
- `app/modules/embeds/router.py` — `GET /api/embeds/og-preview?url=...`
  - SSRF 방어: DNS resolve 후 private/loopback/link-local IP 차단
  - 1MB 응답 한도, 5초 timeout, max_redirects 3, https 강제 검증
- Toolbar에 YouTube + 링크 카드 버튼 추가

### 버그 fix
- **테마 변경 500 (MissingGreenlet)**: `update_deck/doc/slide` 모두 `await db.flush()` 후
  `await db.refresh(d)` 추가. 원인: `onupdate=func.now()`로 `updated_at` expired 상태에서
  `deck_to_dict.isoformat()`이 sync IO 시도.
- **슬라이드 UI 슬라이드답게**: 문서 .prose → 16:9 캔버스 + slide-prose CSS (큰 제목·중앙 정렬)

### 성능 최적화 (1400명 × 1년 운영 준비)
**검사**: Explore 에이전트 4개 병렬 (N+1, 페이지네이션, 동기IO, DB 인덱스).
N+1는 깨끗 — 이미 batch pre-fetch 적용됨. 다른 3개 축은 모두 수정.

**A. 동기 IO → asyncio.to_thread** (`app/core/files.py` 신규 + 13 파일):
- PDF 생기부 (ReportLab 200~500ms) — 학기말/수시 자기소개서 시즌
- Excel 일괄등록 (openpyxl 50~300ms) — `_parse_excel_sync` 분리
- 비밀번호 해싱 루프 (1000명 = 100초 → 5~15초 비차단)
- 파일 IO 6개 (classroom 첨부·branding 파비콘·과제 제출·연구 산출물·자료실·학생 산출물)
- QR PNG/SVG (qrcode + PIL)
- OG DNS resolve (socket.getaddrinfo → loop.getaddrinfo)
- 신규 헬퍼: `write_bytes_async / ensure_dir_async / read_bytes_async / unlink_async`

**B. 페이지네이션 6개 endpoint**:
- timetable enrollments (학기 명단 — 1400명 5~10MB → page/per_page 2000)
- chatbot sessions/all + sessions (limit/offset)
- club activities/submissions (limit 50)
- classroom course posts (limit 30)
- 응답 shape: `{items, limit, offset, [total]}` — frontend는 Array.isArray로 후방 호환
- frontend 업데이트: `/system/enrollments`, `/club admin`

**C. DB 인덱스 15개** (`525376517c78_add_performance_indexes_1400_user_1year.py`):
- HIGH: chat_messages, audit_logs(2), assignment_submissions, student_grades,
  student_mock_exams, documents
- MED: classroom_posts, contests, contest_submissions, classroom_doc_revisions,
  classroom_survey_responses, problems, club_activities, club_submissions
- 멱등 migration (인덱스/테이블/컬럼 없으면 skip)
- dev DB 적용 검증 완료

### Production 인프라 (`production/` + `scripts/setup-production.sh`)
**우분투 헤드리스 서버 한 방 셋업** — 1400명 × 1년 단일 노트북 운영:

- `production/systemd/` — gs-backend(gunicorn 6 worker, RAM 4GB) /
  gs-frontend(Next standalone, RAM 2GB) / gs-hocuspocus(Yjs WS, RAM 2GB)
  - 죽으면 5초 안에 자동 재시작, 부팅 시 자동 시작
  - 메모리 누수 보호 (`--max-requests 2000`), 재시작 폭주 방지
- `production/nginx/gs.conf` — 단일 진입점 (`/` frontend, `/api/` backend,
  `/yjs` WebSocket), gzip + static cache + 보안 헤더
- `production/scripts/backup.sh` — 매일 새벽 2시 pg_dump + storage tar.gz
  (30일 보관, 외장 SSD `BACKUP_DEST` 지정 가능)
- `production/scripts/generate-prod-keys.sh` — JWT/암호화/Hocuspocus token
  약한값 검출 + 강한 랜덤 교체 (멱등)
- `scripts/setup-production.sh` — 9단계 자동 (패키지 → venv → build → 키 →
  systemd → nginx → ufw → cron)
- `production/README.md` — 운영 명령, 동접 한계, 사고 대응, 점검 체크리스트

**사용**: `bash scripts/setup-production.sh` 한 줄. 끝나면 학교 LAN에서
`http://<노트북IP>/` 접속.

### 통계 (2026-05-20)
- Commit 5개: 슬라이드 버그fix · 동기IO · 페이지네이션 · 인덱스 · production 셋업
- 새 파일: production/(7), backend/app/core/files.py, slide-canvas.css,
  alembic migration, scripts/setup-production.sh
- 수정: 약 25개 파일 (페이지네이션 6 + asyncio.to_thread 13 + 슬라이드 UI + 마이그레이션)
- 1400명 × 1년 운영 준비 완료: dev → production 전환 1줄 + 4가지 직접 손볼 것

---

## 2026-05-20 후반 — Google Classroom fidelity + 학기 보관 + 알림 시스템

### Google Classroom 디테일 재디자인 (실 스크린샷 reference)
- `PostStreamCard` 신규 shared component — "OO님이 새 (타입) 게시: 제목" 정형 문구
  + 오렌지 그라데이션 클립보드 아이콘 + 우측 날짜 "YYYY. MM. DD." + ⋮ kebab
  + 타입 배지 제거 (실 Google 안 씀)
- 수업 과제 탭: 주제 필터 드롭다운 + 큰 주제 헤더 + 항목 클릭 시 인라인 펼침
  ("기한 없음" + "N 제출함 / M 할당됨" 큰 숫자 + "과제 안내 보기" 링크)
- CourseCard 배너 minHeight 110→160px, 강좌명 22px, 하단 액션 row
  (진행상황 / 폴더 / 학생 수 / ⋮)

### 학기 단위 보관 (Google 식 "보관된 강좌")
- 정책: 학기 전환 시 현재 학기만 메인 + "이전 학기" 메뉴에서 과거 강좌 read-only
- 본인 관련만:
  - 교사: 본인이 가르쳤던 강좌
  - 학생: 본인이 수강했던 강좌 (status 무관 — 졸업·전학 학생도 본인 데이터)
  - admin: 모든 과거 학기
- 신규 endpoint: `GET /api/classroom/courses/_archived`
  (학기 정보 포함, 학기별 그룹화용 메타)
- `GET /api/classroom/courses/{cid}`에 `is_past_semester` + `semester` 필드 추가
- Server-side guard: 과거 학기에는 POST/PUT/DELETE 차단 (409)
  - 글 작성/수정, 댓글 작성 모두
- 신규 페이지: `/classroom/archived` + `/s/classroom/archived`
  - 학기별 그룹화 ("2024학년도 2학기" 식 헤더)
  - 카드 좌상단에 "보관" 배지 (회색 오버레이)
- 강좌 상세 페이지: is_past_semester=true 시 상단 amber 배너 + canEdit 자동 false
- 메인 클래스룸 페이지 헤더에 "이전 학기" 버튼 (admin·student 둘 다)

### 알림 시스템 — in-app + browser OS notification
**A+B 동시 구현** (Web Push/Service Worker는 제외 — 학교 LAN 환경 오버킬):

**Backend**:
- 모델 `Notification(user_id, type, title, body, link_url, meta, source_user_id,
  is_read, read_at, created_at)`
- alembic migration 6de8959636ba
- 신규 모듈 `notifications/router.py` — 6 endpoint
  - GET / / unread-count / mark-read / mark-all-read / delete / clear
- 헬퍼 `services/notification.py:notify_users(db, user_ids=[...], ...)`
  - 본인 자신 자동 skip, best-effort (실패해도 원 작업 안 막음)

**Frontend**:
- `components/NotificationBell.tsx` — 사이드바 학기 표시 바로 아래
  - 60초 polling, 빨간 점 + 숫자 배지 (99+ cap)
  - 클릭 시 드롭다운 (최근 15개, unread는 cream 배경 + accent 점)
  - 알림 클릭 → link_url 이동 + 자동 읽음
  - **브라우저 OS 알림**: 첫 클릭 시 권한 요청, 새 알림 + 탭 background면 OS 알림
  - "모두 읽음" 버튼, collapsed 모드 대응

**트리거 6종 (적용 완료)**:
1. 강좌 글 작성 (공지/자료/과제) → 강좌 active 수강생 전체
2. 과제 제출 → 과제 등록 교사 (assignment.created_by_id)
3. 과제 채점 (review_submission) → 제출 학생 (review_comment 포함)
4. 수업 댓글 → 글 작성자 + 다른 댓글 작성자 (본인 제외 자동)
5. 마감 임박 24시간 전 → 미제출 학생 (1시간 윈도 + due_reminder_sent_at 마크)

### 수업 댓글 (Google Classroom 식)
- 모델 `CoursePostComment(post_id, author_id, content, created_at)`
- 신규 endpoint 3개 (`/api/classroom/posts/{pid}/comments` 외)
- Frontend PostDetailView 하단 `CommentsSection`:
  - Google 식 rounded input + 전송 버튼 (Enter)
  - 32px 동그란 아바타 (이름 첫 글자)
  - 본인/교사/admin은 hover로 삭제 버튼
  - "방금 / N분 전 / N시간 전" 상대 시간

### 마감 임박 cron (background scheduler)
- `core/notification_scheduler.py` — backup_scheduler와 동일 패턴
- lifespan에서 task 시작, 1시간 tick
- 매 tick: due_date가 23~25시간 후 + due_reminder_sent_at IS NULL 과제 → 미제출 학생만 발송
- 발송 후 `due_reminder_sent_at` 마크 → 정확히 1회

### 통계 (2026-05-20 후반)
- Commit 5개: Classroom UI 디테일·이전 학기·알림 시스템·추가 트리거 3종·문서
- 새 모델 2개: Notification, CoursePostComment
- 새 모듈: notifications, core/notification_scheduler
- 신규 endpoint: archived(1) + notifications(6) + comments(3) = 10
- 총 endpoint: 363 (이전 354)
- 새 페이지 2개: /classroom/archived, /s/classroom/archived
- alembic migrations 2개 (notifications, post_comments + due_reminder_sent_at)
- TS 0 error, backend boot 363 endpoints OK

### Google Forms fidelity + 내 작업물 통합 페이지 + Excel export

**1. CourseBanner 칩 3개 제거**: 협업문서·프리젠테이션·설문지 (실 Google엔 없음)

**2. 설문지 빌더 — Google Forms 식 재설계**
- 페이지 배경 라벤더(#f0ebf8), 제목 카드 상단 10px 보라 바
- 큰 제목(28px) + 설명 입력, 포커스 시 보라 밑줄
- 질문 카드 좌측 6px 보라 보더 (canEdit 시)
- "게시" 버튼 보라색, 타입 배지 옅은 보라

**3. 내 작업물 통합 페이지** (`/workspace` / `/s/workspace`)
- 신규 `components/workspace/MyWorkspaceView.tsx` — 3개 탭 (문서/프리젠테이션/설문지)
- 본인 작성만 (mine=true 필터)
- 강좌 무관 (단독 + 강좌 안 모두)
- 컬러 그라데이션 헤더 카드 (Google Forms/Docs/Slides 식)
- Backend mine=true 필터 추가:
  - GET /api/classroom/docs?mine=true (owner_id 필터)
  - GET /api/classroom/decks?mine=true
  - surveys는 기존 mine 지원
- 사이드바 메뉴 추가 (admin: "내 작업물", student: 기존 "내 문서" → 통합)

**4. 설문 결과 Excel(.xlsx) 다운로드**
- GET /api/classroom/surveys/{sid}/results.xlsx
- openpyxl + asyncio.to_thread (event loop 비차단)
- 헤더 굵게 + 컬럼 폭 자동
- 결과 페이지에 [Excel 녹색] + [CSV 회색] 버튼 둘 다
- 한컴 셀·MS Excel·구글시트 모두 호환

### 통계 (Google Forms 디테일)
- Commit 1개 + docs
- 새 파일: MyWorkspaceView.tsx, /workspace, /s/workspace
- 백엔드 paths +1 (xlsx export)
- 알림 트리거 6종 모두 운영 중

---

## 2026-05-20 심야 — 협업 스프레드시트 (fortune-sheet + Yjs)

### 배경
사용자 요구: "설문지에서 스프레드시트로 동시 공유·편집". 가벼움 + 실시간 협업 +
오픈소스 동시 만족 필요.

### OSS 후보 조사 (general-purpose agent)
| 후보 | 라이선스 | 상태 | 협업 | 채택 |
|---|---|---|---|---|
| Univer | Apache 2.0 | 활발 (13k) | **Pro 전용 (유료)** | ❌ 학교 자체운영 정책 위반 |
| Luckysheet | MIT | **2025-08 archived** | 자체 protocol | ❌ deprecated |
| x-spreadsheet | MIT | 2024-08 stale | 없음 | ❌ |
| **fortune-sheet** | **MIT** | **2025-11 active** (3.6k) | onOp/onChange callback | ✅ |

### 시작 → 폐기 → 채택 흐름
1. **Univer 시도** (commit `3e7667a`): 통합·페이지·설문연동 완료, 단일사용자 모드.
   협업 plugin이 Pro 종속 발견 → 폐기.
2. **fortune-sheet 채택** (commit `6eaf4d1`):
   - Univer 패키지 제거 → `@fortune-sheet/react`, `@fortune-sheet/core` 설치
   - SheetEditor.tsx 완전 재작성

### 협업 아키텍처
- HocuspocusProvider `name="sheet-{sheetId}"` (기존 doc-/deck- 패턴)
- backend-hocuspocus/auth.ts에 TargetKind="sheet" 추가, resourcePath 분기
- Y.Map("sheet")에 SNAPSHOT_KEY로 fortune-sheet 데이터 통째 보관
- 변경 흐름: `onChange` → 350ms 디바운스 → `Y.Map.set` → Hocuspocus broadcast
- 수신: `Y.Map observe` → loop 차단 flag로 setData
- 다른 셀 동시: Yjs CRDT 자동 머지. 같은 셀: LWW (학교 환경 충돌 드묾, OK)
- Hocuspocus가 `sheet-{id}/yjs-snapshot` 자동 저장 (storage.ts 코드 그대로 활용)
- Awareness: 사용자 색·이름 등록

### Backend 구조 (sheet 모델·라우터)
- `ClassroomSheet(course_id, owner_id, title, yjs_state, access_mode,
  source_survey_id, settings, is_archived)`
- `SheetMember(sheet_id, user_id, role)` — specific_users 모드
- alembic migration `57f818d2105d`
- 모듈 `classroom_sheets/router.py` — CRUD + 멤버 + 사용자 snapshot-state +
  Hocuspocus yjs-snapshot + permission + 설문 연동 (`_from-survey`, `_survey-data`)
- 권한 3종: classroom.sheet.create/view/edit

### Frontend
- `components/sheets/SheetEditor.tsx` — dynamic import + ssr:false (canvas 의존)
- 페이지 `/sheets/[sid]` (admin) — 학생용은 추후
- `/workspace`에 "스프레드시트" 4번째 탭
- 설문 결과 페이지 "스프레드시트로 분석" 버튼 → 자동 시트 생성 + 응답 데이터 주입

### 번들 영향 (학생 노트북 부담)
- 일반 페이지: 0KB (동적 import + Next.js chunk 분리)
- 시트 페이지만 fortune-sheet ~400KB chunk + Yjs/Hocuspocus 이미 캐시
- Univer 대비 약 1MB 절감

### 통계 (협업 스프레드시트)
- Commit 2개: Univer 통합 + fortune-sheet 전환 (사실상 fortune-sheet만 운영)
- 새 모델 2개: ClassroomSheet, SheetMember
- 새 모듈: classroom_sheets
- 신규 endpoint 9개 (CRUD 4 + 멤버 3 + Hocuspocus 3 + 설문연동 2)
- alembic migration 1개

---

## 보류 작업 (다음 세션 시작점)

이번 세션에 논의·기획만 하고 코드 변경 안 한 항목들. 우선순위 순:

### 1. 코드 모듈화 (이전 약속, 미진행)
Explore agent가 식별한 HIGH 2건:
- `frontend/src/app/(admin)/classroom/[cid]/page.tsx` (845줄) →
  CourseworkSection.tsx 분리 + 인라인 함수들 _components/에 추출
- `frontend/src/app/(admin)/students/_tabs.tsx` (836줄) →
  9개 탭을 _tabs/ 디렉토리에 파일별 분산 + `useFetchPaginatedData` custom hook
공통: 비슷한 fetch+setState+try/catch 패턴 hook으로 통합 (15곳)

### 2. 개인 드라이브 + Quota 아키텍처 (사용자 결정 보류)
사용자 제안: "최고관리자가 계정 등록 시 quota 부여 → 사용자별 종속 드라이브 →
도구 사용. SSD 용량 우려로 단일파일 100MB·학기 archive 등 제약 필요."

용량 계산 (1400명 기준):
- 교사 100 × 5GB + 학생 1300 × 1GB = 1.8TB 할당
- 실 사용 추정 300~600GB (할당의 10~30%)
- 본체 SSD 256GB도 가능 (storage만 외장 SSD/NAS 마운트 시)
- 권장: 본체 512GB+ / 외장 1TB SSD/NAS

진행 단계 (사용자 선택 대기):
- **1단계 (Quota 핵심)**: User.quota_bytes + used_bytes 컬럼 + 등록 시 부여 +
  사용량 추적 + 단일파일 100MB 제한 — 4~5시간
- **2단계 (드라이브 UI)**: /drive 페이지 (현 /workspace 확장) — 폴더 트리 좌측 +
  콘텐츠 우측 + 용량 게이지 — 1일
- **3단계 (Folder 모델)**: Folder(owner_id, parent_id, name) + 각 도구
  folder_id FK + 이동 API — 1일
- **4단계 (클래스룸 첨부 통합)**: 강좌 글에서 "내 드라이브에서 선택" — 4~5시간
- **5단계 (일반 파일 업로드)**: PDF/이미지/zip 등도 드라이브에 — 6시간

권장 정책 (시작값):
- 역할별 기본 quota: super_admin 무제한 / designated_admin 20GB / teacher 5GB /
  staff 2GB / student 1GB
- 단일 파일 100MB
- 80% 도달 시 경고 알림 (notification 인프라 활용)
- 휴지통 30일 (Phase 2)
- 학기 archive (Phase 2)

### 3. 시트 — 학생용 페이지 (`/s/sheets/[sid]`)
admin 페이지(`/(admin)/sheets/[sid]/page.tsx`)와 동일 구조. 권한 가드는 이미
`_resolve_permission`이 학생도 access_mode/SheetMember로 처리하므로 페이지만
복사하면 됨. 30분 작업.

### 4. 시트 셀-단위 Y.Map (성능)
현재 snapshot 통째 broadcast 방식. 큰 시트(1000+ 행)에서 비효율.
셀별 Y.Map(`${sheetId}.${row}.${col}`) 매핑으로 변경 가능. 작업 1일.

---

## 세션 종합 정리 (2026-05-20)

### 전체 통계 (이번 세션 총합)
- Commit 약 20개 + docs 업데이트
- 새 모듈 4개: notifications, classroom_sheets, files(파일가드 강화), embeds
- 새 모델 5개: Notification, CoursePostComment, ClassroomSheet, SheetMember,
  ClassroomPresentation(시트는 별도 추가됨)
- alembic migrations 5개 추가
- 새 endpoint 약 25개
- 새 페이지 4개: /classroom/archived (+학생), /sheets/[sid], /workspace
- 새 컴포넌트: NotificationBell, PostStreamCard, MyWorkspaceView, SheetEditor 등
- 패키지 추가: @fortune-sheet/react, @fortune-sheet/core (Univer 폐기 후)

### 주요 작업 (시간순)
1. 슬라이드 버그fix + 16:9 캔버스
2. 동기 IO → asyncio.to_thread (13개 endpoint)
3. list endpoint 페이지네이션 (6개)
4. DB 인덱스 15개 추가
5. Production 셋업 인프라 (systemd/nginx/backup/scripts)
6. Google Classroom UI 디테일 재디자인 (PostStreamCard, 수업과제, CourseCard)
7. 이전 학기 보관 (Google 식 read-only)
8. 알림 시스템 (in-app + Browser OS) + 트리거 6종
9. 댓글·채점·마감 cron 트리거
10. Google Forms UI 재디자인 + Excel export + 내 작업물 통합 페이지
11. **협업 스프레드시트 (fortune-sheet + Yjs)** — 이번 세션 마지막 큰 작업

### 다음 세션 시작 시 우선순위
1. **모듈화** (HIGH 2건, ~4~5시간) — 이전 약속
2. **개인 드라이브 + Quota** (사용자 결정 후 진행)
3. **시트 학생 페이지** (30분 — 빠른 마무리)

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-28 세션 — 선배 연구 보고서 ZIP + 학생 자가 업로드/승인 + 임시 그룹 + 마법사

### 학교 이전 트리거
사용자가 인근 학교(리눅스만 설치된 구형 노트북)에 플랫폼 이전 + 교내망 only.
첫 오픈 서비스는 "**선배들의 연구자료 검색**". 학교에서 ZIP으로 75개 PDF 받음
(파일명 100% 일관 패턴: `YYYY N학년 S학기 보고서종류(분야)_제목.pdf`).
→ ZIP 일괄 업로드 + 검색 + 학생 자가 업로드 + 교사 승인 흐름 전체 구현.

### Phase A — 과거 연구 보고서 PDF 아카이브 (commit bcc8571)
**모델**: `PastResearch(year/grade/semester/report_type/fields/title/is_excellent
/original_filename/stored_path/file_size/uploaded_by_id)` + alembic `9d5e6bc2392e`.

**파서** ([past_research/parser.py](backend/app/modules/past_research/parser.py)):
- 정규식 1개로 메타 6개 자동 추출 + 다중 분야 split + (우수)/(최우수) tag 자동 분리
- `make_standard_filename()` 역방향 (학생 폼 → 표준 파일명 생성)

**라우터** (`POLICY_PAST_RESEARCH_ZIP` 500MB + 2000 PDF/zip 한도):
- POST `/_bulk-upload` — ZIP → 파싱·검증(PDF magic byte)·중복skip → 결과
- GET "" / _facets — 검색·년도·학기·학년·분야 필터 + facets list

**files 가드** — `_guard_past_research`: 미승인 row는 본인 + supervisor만,
approved는 `past_research.view` 권한 있으면 모두.

**Frontend**: admin `/past-research` 드래그&드롭 ZIP + 검색·필터,
student `/s/past-research` 카드 그리드.

### Phase B — 학생 자가 업로드 + 교사 승인 + 임시 그룹 (commit 6722c50)

**신규 모델 5개**:
- `ResearchSupervision(semester_id+student_id UNIQUE, supervisor_id, topic_title)`
- `TeacherGroup(semester_id, name, type=event|contest|research|etc, owner_id)`
- `TeacherGroupMember(group_id, teacher_id, role)`
- `TeacherGroupStudent(group_id+student_id UNIQUE, assigned_teacher_id)`
- `GroupSubmission(group_id, student_id, file_url, status, reviewed_by_id, student_artifact_id)`

**확장 모델 2개**: PastResearch + ClubSubmission 모두 status/reviewed_by_id
/reviewed_at/rejection_reason/student_artifact_id 컬럼 추가 → 일관 승인 흐름.

**alembic** `7f3a8d5c1e92` — PostgreSQL IF NOT EXISTS 멱등 (init_db가 backend
reload 시 신규 테이블을 미리 만들어 alembic 충돌 회피).

**Service** [services/student_artifact_sync.py](backend/app/services/student_artifact_sync.py)
`ensure_student_artifact()` — 승인 시 StudentArtifact 자동 생성 (file_url 공유, 실
파일 복제 X). 본인 산출물 갤러리에 동시 등록.

**알림 트리거 5종** (notify_users):
1. 학생 제출 → supervisor 알림
2. 교사 승인 → 학생 + StudentArtifact 자동 등록
3. 교사 반려 → 학생 + 사유
4. 부장이 참여 교사 초대 → 교사
5. 교사가 학생 배정 → 학생

**Frontend 5개 신규 페이지**:
- 학생 `/s/research-submit` — PDF 드래그 → 파일명 자동 파싱 → 폼 + 표준 파일명 미리보기
- 학생 `/s/my-activities` — 본인 속한 그룹 list + 산출물 업로드
- 교사 `/research-review` — 통합 승인 큐 (연구·행사·동아리 3탭)
- 교사·부장 `/my-groups` — 학번 검색 학생 배정 + 부장은 그룹 생성·교사 초대
- admin `/system/research-supervisors` — 학기별 매핑 CRUD + CSV 일괄

**메뉴 정리**: "과거 연구 자료" 메뉴 학생/admin 양쪽에서 제거 (ResearchProject
모델·페이지는 보존, 다른 학교 호환). "선배 연구 보고서"로 통일.

### Phase C — CSV 일괄 + 마법사 통합 (commit ba5c975)
- backend: `POST /_supervisions/_bulk-import` + `_csv-template` (5000행 한도, N+1 회피)
- frontend: admin 페이지 "CSV 일괄" 모달 (템플릿 + dry-run + 실제)
- **OnboardingWizard 8 → 9단계** — 신규 `Step8Supervisors` (마법사 안에서 CSV 흐름)

### Phase D — 모듈화 분할 (sub-module 패턴)

**student_self 패턴 발견**: sub-router include가 아닌, sub-module이 부모 router를
import해 `@router.get()` 데코레이터를 직접 적용 → FastAPI "Prefix and path
cannot be both empty" 회피.

```python
# router.py
router = APIRouter(prefix="/api/x", tags=[...])
from . import sub1, sub2  # 마지막에 import (circular 회피)

# sub1.py
from app.modules.x.router import router
@router.get("")  # 빈 path OK!
async def handler(...): ...
```

**분할 완료**:
- `past_research/router.py` 711 → router 27 + 6 sub-module (max 304)
  : _helpers / browse / admin_bulk / student_flow / review / supervision
- `teacher_groups/router.py` 656 → router 20 + 4 sub-module + _helpers (max 270)
  : groups / members / students / submissions
- frontend `my-groups/page.tsx` 381 → 123 + `_components/` 2개
  (GroupDetailView 207 + CreateGroupModal 86)

### 테스트 (39 신규 + invariants 5 = 44 pass)
- `test_research_supervision.py` (8): CRUD + IDOR + CSV bulk (dry/real/updates/5000행)
- `test_research_submit_flow.py` (6): 제출 → 승인 → StudentArtifact + 알림 + 반려 + 비-supervisor 차단
- `test_teacher_groups.py` (9): admin/부장 생성 + 멤버 초대 + 학생 배정 + IDOR + 검색
- `test_past_research_parser.py` (6) 기존 통과
- convention invariants 5/5 통과 (storage section, file 컬럼, sensitive 권한 모두)

### 영구 해결 — Windows git SSH 키
이전 세션 24개 commit이 SSH 키 미등록으로 push 못 했음. 해결:
`cp ~/.ssh/id_ed25519{,.pub} /mnt/c/Users/sinbc/.ssh/` (WSL → Windows).
이후 PowerShell git도 정상 push.

### 통계 (2026-05-28 세션)
- Commit 5개: bcc8571 (A) + 6722c50 (B) + ba5c975 (C) + 모듈화/테스트 commit
- Backend: 467 → **490 routes** (+23)
- 새 모델 5개 + 확장 2개
- 새 모듈 2개: past_research (6 sub-module), teacher_groups (4 sub-module + helpers)
- 새 service 1개: student_artifact_sync
- 새 페이지 7개 + 컴포넌트 3개
- alembic 2개 (멱등)
- 권한 16개 신규 + grant_default_roles 자동 부여
- 알림 트리거 5종
- 테스트 95 → 134 (+39)

### 다음 세션 후보
1. **학교 가서 셋업** — `bash scripts/setup-production.sh` + 백업 ZIP 복원 + dev 시연
2. **시연 후 buggy fix** — 실제 학생/교사 운영 흐름에서 발견되는 사소한 UX
3. **frontend 추가 모듈화** — classroom/[cid]/page.tsx 845줄, students/_tabs.tsx 836줄
4. **챗봇 LLM 주관식 채점** (이전 후보)
5. **Storage Volume Step 2 Phase 2** (이전 후보)
6. **HWP 협업** — rhwp v2 출시 시 재검토

다음 세션 catch-up: 이 CLAUDE.md + sub-module 패턴 (`from .router import router`).

---

## 2026-05-28 마감 — 학교 셋업 결정 (실행 직전 합의)

### 구성 결정
- **원래 계획**: 3대 (서버·DB·미러)
- **변경**: 1대(미러)는 보류, DB도 분리 안 함. **2대 — 서버 노트북 A + 스토리지 노트북 B (NFS)**
- 원래 윈도우 노트북을 SMB 외장 SSD 대용으로 검토 → 결국 **양쪽 다 리눅스 깡통 노트북**으로 진행 결정

### 데이터 배치
| | 노트북 A (서버) | 노트북 B (스토리지) |
|---|---|---|
| PostgreSQL DB (5~20GB) | ✅ 본체 SSD | ❌ (네트워크 latency 민감) |
| `backend/storage/` (300~600GB 추정) | ❌ | ✅ NFS export |
| 자동 백업 ZIP | ❌ | ✅ `/mnt/gs-storage/backups/` |

### 셋업 가이드 (실제 학교 가서 따라할 거)
**[SCHOOL_SETUP_2NODE.md](SCHOOL_SETUP_2NODE.md)** 신규 — 0~9단계 시나리오 + 막힐 부분
대처 + 가져갈 체크리스트. 2~3시간 예상. 학교 가서 휴대폰·태블릿으로 보고 따라하기.

기존 셋업 문서들:
- [DEPLOYMENT_DAY.md](DEPLOYMENT_DAY.md) — 윈도우→우분투 설치부터 (3~5h, 다른 시나리오)
- [DEPLOY_TO_SCHOOL.md](DEPLOY_TO_SCHOOL.md) — 우분투 설치된 상태 + 1대 (1~2h)
- [production/README.md](production/README.md) — 가동 후 운영 명령

### 추후 확장 트리거
- 미러 노트북 추가 (안정성) — cron으로 매일 pg_dump rsync
- DB 분리 (성능) — `.env`의 `DATABASE_URL` 1줄 변경
- 외장 SSD/NAS (용량) — `/etc/fstab` mount 지점 변경

### Storage Volume Step 2 Phase 2 — 여전히 미완
- `StorageVolume` 모델 + `/proc/mounts` 자동 감지 UI + `get_storage_root()` 헬퍼 모두 있음
- 단 실 업로드는 `backend/storage/` 고정 → 학교 셋업에서 **OS 심볼릭 링크로 해결**
  (`ln -s /mnt/gs-storage backend/storage`)
- 추후 multi-volume 라우팅 통합 작업은 다음 세션 후보

다음 세션 catch-up: 위 결정사항 + SCHOOL_SETUP_2NODE.md 시나리오 보면 OK.

---

## 2026-05-21 세션 — Phase 1.0 + 1.5 + 2 (드라이브 + 마법사 + Google 연동 + 인사이동 + 스토리지)

> 학교 자체 운영 플랫폼의 핵심 인프라 완성. 1400명 × 1년 + 인사이동 + 외장 스토리지까지 통합.

### 🎯 핵심 취지
**학교에 수업/업무 데이터 영구 누적 + 민감정보 외부 유출 방지 + 동일인 자료는 학기/학년 무관 이어서 사용**

### Phase 1.0-A: 모델·DB 확장 + soft delete

**신규 모델 3개**:
- `Department` (학교 부서, lead_user_id로 부장 지정)
- `CourseTeacher` (M2M, owner / co_teacher 역할 분리)
- `UserFavoriteCourse` (즐겨찾기 강좌)

**User 확장 9개 컬럼**:
- 드라이브: `quota_bytes`, `used_bytes`
- 인사 상태: `lifecycle_status` (active/departed/graduated/transferred), `user_type` (regular/temporary/substitute), `expires_at`
- 부서/학년부장: `department_id` (use_alter=True FK), `is_grade_lead`, `lead_grade`
- 외부 연동: `google_email`

**Course 확장 6개 컬럼**:
- 강좌 타입: `course_type` (subject/grade_office/class_homeroom), `grade_level`
- 카드 디자인: `banner_color`, `banner_image_url`, `icon`
- 열람 권한: `viewable_by` (all_teachers/assigned_only)

**4개 협업 도구 soft delete**:
- ClassroomDocument, ClassroomSheet, ClassroomPresentation, Survey
- `deleted_at`, `deleted_by`, `storage_bytes` 컬럼

**alembic migration d6aa2049798f**:
- 모든 server_default 명시 (기존 데이터 안전)
- 역할별 기본 quota 자동 부여 (teacher 500MB / student 200MB / staff 300MB / designated_admin 1GB / super_admin 0=무제한)

### Phase 1.0-B: Quota 백엔드

**`app/core/quota.py`** 신규:
- 상수: `DEFAULT_QUOTA_BY_ROLE`, `TEMPORARY_QUOTA=50MB`, `FILE_SIZE_LIMIT=50MB`, `QUOTA_WARNING_THRESHOLD=0.8`
- 헬퍼: `check_quota` / `consume_quota` / `release_quota` / `adjust_quota` / `is_unlimited` / `default_quota_for` / `assign_default_quota` / `_maybe_warn` (24h 쿨다운 알림)

**계정 생성 5곳 hook**:
- users/crud.py create_user
- users/bulk.py CSV 일괄
- auth/registration.py super_admin 첫 가입
- services/user_csv_io.py / semester_import.py

**원칙**: 개인 도구만 차감 / 클래스룸·산출물·과제는 학교 공통 (quota 무관). 휴지통은 quota 차감 유지 (보호 기간 30일).

### Phase 1.0-C: 내 드라이브 + 휴지통 30일

**Backend `app/modules/drive/`** (6 endpoints):
- GET `/api/drive/me` — quota/used/만료일/사용률
- GET `/api/drive/items?trash=&type=` — 통합 자료 목록
- DELETE `/items/{type}/{id}` — soft delete
- POST `/items/{type}/{id}/restore` — 복구
- DELETE `/items/{type}/{id}/permanent` — 영구 삭제 + quota 환불
- POST `/trash/empty` — 휴지통 비우기

**Cron** (notification_scheduler 통합):
- 24시간 1회 `purge_expired_trash` — 30일 경과 자료 hard delete + owner별 quota 환원
- `_last_purge_at` 캐시로 중복 실행 방지

**Frontend**:
- `components/drive/DrivePage.tsx` — admin/student 공유 (mode prop)
- `/drive` + `/s/drive` 페이지
- 6개 탭: 전체 / 문서 / 시트 / 덱 / 설문 / 휴지통
- 사용량 게이지 (80% 노랑 / 90% 빨강 / 무제한 emerald)
- 만료 임박 배너 (시간강사 7일 이내)
- 카드 ⋮ 메뉴: 휴지통 이동 / 복구 / 영구 삭제

권한: `drive.use` (default 모든 사용자, grant_default_roles.py에서 자동).

### Phase 1.0-D: 부서 CRUD + 🧙 온보딩 마법사 8단계

**Backend**:
- `app/modules/departments/router.py` (4 endpoints): GET/POST/PUT/DELETE + `_bulk`
- `app/modules/system/onboarding.py` (5 endpoints): status/school/step/complete/reset
- 상태는 SchoolConfig 키-밸류로 저장 (`onboarding.completed_at`, `school.name` 등)

**Frontend `/system/departments`**:
- 줄별 인라인 편집 + 표준 7개 부서 일괄 등록 (교무부·학생부·연구부·진로상담부·교육과정부·정보부·방과후부)
- 위/아래 정렬 + 부장 드롭다운

**🧙 OnboardingWizard (`components/onboarding/`)**:
- 8단계 stepper (다음/이전/건너뛰기/완료)
- last_step 복원, X로 닫으면 진행 보존
- Step1Welcome / Step2Departments / Step3Semesters / Step4Teachers / Step5Students / Step6Homerooms / Step7Courses / Step8Done
- 줄별 입력 + CSV 템플릿 다운로드 + 일괄 등록
- 대시보드 우상단 🧙 버튼 (미완료 시 animate-pulse)
- `/system/onboarding` 직접 진입 가능 (재실행)

### Phase 1.0-E: 인사이동 도구

**Backend `app/modules/users/lifecycle.py`**:
- PATCH `/api/users/{id}/lifecycle` — lifecycle_status 변경 (active/departed/graduated/transferred)
- POST `/api/users/{id}/transfer-ownership` — 자료 일괄 owner 이관 + quota 재계산
- `disable_account=True`로 함께 status=disabled 처리
- `_ensure_not_last_super_admin` 보호

**notification_scheduler 확장**:
- `_disable_expired_users` — expires_at 도래한 임시/대리 계정 자동 비활성화

**Frontend `LifecycleModal`** (`/system/users` 행 액션):
- 인사 상태 선택 → 계정 비활성화 토글 → 자료 후임자 이관 옵션 → 후임자 드롭다운 → 경고 배너

### Phase 1.0-F: 공동교사 시스템

**Backend `app/modules/classroom/teachers.py`**:
- GET/POST/DELETE `/api/classroom/courses/{cid}/teachers`
- 공통 헬퍼: `is_course_editor` (owner OR co_teacher), `is_course_editor_or_admin`
- Course.teacher_id = **owner** (소유자), CourseTeacher M2M = co_teacher
- co_teacher: 글 작성/채점/멤버 관리 OK. 강좌 삭제·소유권 이관은 owner만.

### Phase 1.0-G: 학기 자동 강좌 생성

**Service `app/services/course_seed.py`**:
- 학년부 강좌: is_grade_lead=True → owner, 같은 학년 담임 → co_teacher
- 학급 강좌: 담임 → owner, 해당 학급 학생 자동 등록
- dry_run + 멱등 (기존 강좌 skip)

**Router `app/modules/classroom/course_seed.py`**:
- POST `/api/classroom/courses/_seed-auto` (semester_id + 옵션)

**마법사 Step7에 통합** (미리보기 + 실행).

### Phase 1.0-H: 클래스룸 메인 재구성

**`components/classroom/CourseGroupedView.tsx`**:
- 년도·학기 그룹화 + 토글 (sessionStorage 보존)
- 즐겨찾기 ⭐ 별도 섹션 (`POST/DELETE /api/classroom/courses/{cid}/favorite`)
- 검색 + 타입 필터 (subject/grade_office/class_homeroom)
- 현재 학기 자동 펼침, 과거 학기 접힘

**`app/modules/classroom/favorites.py`** (3 endpoints).

### Phase 1.0-I: 카드 커스터마이징

**`app/modules/classroom/customize.py`**:
- PATCH `/api/classroom/courses/{cid}/customize` — banner_color / icon / clear_banner_image / viewable_by
- POST `/api/classroom/courses/{cid}/banner-image` — 이미지 업로드 + PIL 압축 (max 800x500, quality 80)
- POLICY_IMAGE + validate_upload (convention invariant)
- owner quota 차감 + 기존 이미지 환원

**files/router.py `_guard_classroom` 확장**:
- `classroom/banners/` 경로 별도 분기: Course.banner_image_url 매칭 + viewable_by + co_teacher + 수강생 4중 가드

### Phase 1.0-J: iframe preview

**`components/classroom/GoogleDocPreview.tsx`**:
- Google Docs/Sheets/Slides/Drive URL 자동 감지 (regex)
- iframe sandbox preview (lazy, no-referrer)
- 접기/펼치기 토글 + "새 탭에서 열기"

### Phase 1.0-K: 강좌 열람 권한 유동

- `Course.viewable_by` enum: all_teachers (default) / assigned_only
- customize endpoint에서 super_admin/designated_admin만 변경 가능

### Phase 1.0-L: 종합 검수
- TypeScript 0 error
- Backend boot 406 routes
- pytest convention invariants 5/5
- pytest storage security 21/21
- pytest backup roundtrip 6/6
- pytest security marker 128/128

### Phase 1.5-M: Google OAuth 인프라

**모델**: `GoogleConnection` (user 1:1, refresh_token Fernet 암호화).

**`app/modules/google_integration/router.py`** (9 endpoints):
- GET/PUT `/api/google/config` (admin Client ID/Secret)
- GET `/api/google/auth-url` — OAuth 시작 URL (state 1회용)
- GET `/api/google/callback` — code → 토큰 교환, refresh_token 암호화 저장
- GET/DELETE `/api/google/me` — 본인 연결 상태/해제 (Google에 revoke 요청)
- GET `/api/google/drive/files` — Drive API proxy

**핵심**: httpx 자체 OAuth 흐름 (외부 라이브러리 의존 X). SchoolConfig에 client_id/secret Fernet 암호화 저장. refresh_token으로 access_token 즉시 재발급 (메모리 only).

**Frontend `/system/integrations/google`**:
- Client ID/Secret 설정 + Authorized redirect URI 안내
- Google Cloud Console 셋업 가이드

### Phase 1.5-N: Drive UI split view

**`components/drive/GoogleDriveSidePanel.tsx`**:
- 미연결: "Google 계정 연결" 버튼 → popup OAuth → postMessage로 자동 갱신
- 연결: 본인 Drive 파일 그리드 (icon, name, modifiedTime, webViewLink)
- 검색 + 외부 링크

**DrivePage 통합**: 상단 "Google Drive" 토글 → 우측 360px 패널 (lg breakpoint).

### Phase 1.5-O: Export to Google Drive

**`app/modules/google_integration/export.py`**:
- POST `/api/google/export/docs/{id}` — TipTap HTML → Google Docs (자동 변환)
- POST `/api/google/export/sheets/{id}` — fortune-sheet → XLSX (openpyxl) → Google Sheets
- multipart/related upload (Drive API v3)
- PPT는 지원 X (캔버스 기반이라 변환 손실 큼)

### Phase 1.5-P: 클래스룸 구글 문서 첨부
- `GoogleDocPreview` 컴포넌트 활용 (Phase 1.0-J에서 작성)
- 클래스룸 PostDetailView에서 attachments URL의 Google docs 감지 시 자동 사용 가능

### Phase 1.5-R: 부서장 권한 위임

**`app/modules/departments/delegation.py`** (5 endpoints):
- GET `/api/departments/{id}/members` — 부서 소속 사용자
- GET `/api/departments/{id}/available-permissions` — 위임 가능 권한 목록 (본인 권한 ∩ DELEGATION_BLOCKED_PREFIXES 제외)
- GET/POST/DELETE `/api/departments/{id}/delegations` — 권한 부여/회수

**원칙**:
- 부장(Department.lead_user_id) 또는 admin만 위임
- DELEGATION_BLOCKED_PREFIXES: system/permission.manage/user.manage.delete/google.integration.configure/department.manage
- 부장은 본인 권한 범위 내 위임 가능 (escalation 차단)
- audit_log is_sensitive=True

**Frontend `/system/departments/[id]/delegations`**:
- 좌측 멤버 list (위임 수 카운터)
- 우측 카테고리별 권한 카탈로그 (granted 표시 + 추가/회수 1클릭)

### Phase 2-Q: Multi-volume Storage

**모델**: `StorageVolume` (name, path, capacity, used, priority, is_active, last_status).

**`app/modules/storage_volumes/router.py`** (5 endpoints):
- GET `/api/storage/volumes` — 실시간 disk usage (`shutil.disk_usage` async)
- POST/PUT/DELETE `/api/storage/volumes/{id}` — CRUD
- POST `/api/storage/volumes/{id}/check` — 헬스체크 (mount 가능 여부)

**헬퍼**: `pick_volume_for_upload(db, required_bytes)` — active + priority 낮은 순 + 여유 용량 자동 선택.

**Frontend `/system/storage`**:
- 볼륨 카드 (사용량 게이지 80%/90% 색)
- 활성/비활성 토글, 헬스체크, 삭제
- 셋업 가이드 (외장 SSD 마운트 → 경로 등록)

**⚠️ 라우팅 통합은 미완 (다음 단계 작업)**:
- 등록된 StorageVolume은 현재 모니터링용. 모든 실 업로드는 `backend/storage/` 고정 디렉터리 사용.
- 헬퍼 `app/core/files.py:get_storage_root(db, required_bytes)` 추가됨 — active volume 선택 후 root Path 반환, 실패/없으면 `DEFAULT_STORAGE_ROOT` fallback. **사용처 0개** (다음 세션에서 endpoint별 검증 후 적용).
- backup.py는 변경 안 함 (현재 `backend/storage/` 만 백업). 다중 볼륨 운영 시 사용자가 직접 외장 SSD를 symlink로 활용 가능.

### 양방향 FK warning fix

`User.department_id`에 `use_alter=True, name="fk_users_department_id"` 추가.
- backup.py `Base.metadata.sorted_tables` 호출 시 SAWarning (Department↔User cycle) 해소.
- DB schema 변경 없음 (모델 metadata만 영향). backup 라운드트립 통과.

### 신규 권한 키 (grant_default_roles 자동 시드)
- `drive.use` → STAFF + STUDENT (teacher 자동)
- `google.integration.use` → STAFF + STUDENT
- `google.integration.configure` → admin만 (TEACHER_EXCLUDE)
- `department.view` / `.manage` → admin (manage는 TEACHER_EXCLUDE)
- `storage.volume.view` / `.manage` → admin (TEACHER_EXCLUDE)

### 보안 강화

**files/router.py `_guard_classroom`** 확장:
- `classroom/banners/` 경로 별도 분기 — Course.banner_image_url 매칭 + viewable_by + co_teacher + 수강생 4중 가드
- 추측 차단 (DB row 매칭 안 되면 404)

**Permission 일관성**:
- google.integration.use/drive.use는 default 부여
- google.integration.configure/department.manage/storage.volume.* 는 admin 전용
- DELEGATION_BLOCKED_PREFIXES로 escalation 차단

### 통계 (2026-05-21 세션)

**Backend**: 379 → 424 routes (**+45**)
- 신규 모델: Department, CourseTeacher, UserFavoriteCourse, GoogleConnection, StorageVolume
- 신규 모듈: drive, departments, google_integration, storage_volumes
- classroom 신규 sub: teachers, favorites, customize, course_seed
- alembic migrations 신규 3개 (d6aa2049798f, 259af386dcc1, 08f6e077c897)

**Frontend**: 신규 페이지 6개 + 컴포넌트 16개
- /drive + /s/drive
- /system/departments + /system/departments/[id]/delegations
- /system/onboarding
- /system/integrations/google
- /system/storage
- OnboardingWizard + Step1~8
- DrivePage, GoogleDriveSidePanel, GoogleDocPreview, CourseGroupedView, LifecycleModal

**테스트**: TypeScript 0 error / pytest convention/security/backup 32/32 pass / SAWarning 해소

### 다음 세션 catch-up
1. dev 서버로 마법사/드라이브/부서/Google UX 직접 확인 (start-backend.bat + start-frontend.bat)
2. CLAUDE.md의 "보호된 파일" 목록 확인 — drive/quota/lifecycle 관련 파일 보호 필요
3. backup.py의 `datetime.utcnow()` → `datetime.now(timezone.utc)` 마이그레이션 (Python 3.14 호환)
4. Storage volume이 실제 업로드 흐름에 통합되어야 multi-volume 운영 가능 (현재는 모델 + 관리 UI만)

---

## 2026-05-21 후반 — HWP/HWPX 통합 + 협업 불가 결론

### 무엇을 만들었나
`@rhwp/editor` v0.7.12 (MIT, by Edward Kim) iframe 임베드 기반 한컴 문서 편집기. **단독 편집 + 저장 + 다운로드 + 가져오기 작동.** 협업은 미지원 (rhwp v1 한계).

**Backend** (`app/modules/classroom_hwps/`):
- 모델 `ClassroomHwp`, `HwpMember` + alembic `05a8708cef8d`
- `/api/classroom/hwps` CRUD/멤버/파일업로드 (8개 endpoint)
- `POLICY_HWP` (.hwp/.hwpx, 30MB) + validate_upload 사용
- files/router.py `_guard_hwps` 등록 (storage section invariant)
- 권한 4개: `classroom.hwp.create/view/edit/share` (학생 default 포함)
- drive `ITEM_TYPES["hwps"]` 등록 (휴지통·복구·영구삭제 자동)

**Frontend**:
- `components/hwp/HwpEditor.tsx` — `@rhwp/editor` iframe 임베드, **단계별 phase + 경과초 + 외부 URL 차단 안내 + 재시도 버튼**
- `/(admin)/hwps/[hid]`, `/(student)/s/hwps/[hid]`, `/embed/hwps/[hid]` 3개 페이지
- `ShareDocModal` `entityType="hwp"` 확장
- `DrivePage` 탭/카운트/'+신규'/우클릭/이름바꾸기 (`hwps` 5번째 타입)
- `DrivePicker` + `PostDetailView` + `AssignmentModal` Attachment에 `hwp_id`
- classroom Attachment Pydantic schema `"hwp"` 타입 추가

### 진짜 협업 안 되는 이유 (조사 완료, [docs/HWP_INTEGRATION.md](docs/HWP_INTEGRATION.md))
`@rhwp/editor` postMessage API가 **편집 이벤트(insertText/cursor/selection)를 안 노출**. 노출된 6개는 모두 전체 파일 단위 (`loadFile`/`exportHwpx` 등). Yjs/CRDT가 "변경 단위 broadcast" 못함.

LWW snapshot 우회 = 5초마다 다른 사람 작업 통째로 덮음 = 데이터 손실 disaster.

**진짜 char-level CRDT 만들려면 3개월+ (Rust + WASM + HWP CRDT 설계)**:
- HWP는 nested binary struct (표/문단/문자/shape 4단 중첩) — TipTap·fortune-sheet와 달리 **기존 Y.XmlFragment/Y.Array 매핑 불가**
- HWP 전용 CRDT 새로 설계 (학술 논문 수준)
- 한컴 본가도 char-level CRDT 안 함 (잠금 기반). MS Word도 안 함 (서버 OT)
- char-level CRDT 한국어 문서편집기 = 세상에 0개

**결론**: HWP 단독 편집 유지. 협업 필요하면 TipTap 문서 권장.

### 추후 옵션 (사용자 결정 대기)
| 옵션 | 작업 | 기간 |
|---|---|---|
| A. 잠금 기반 협업 (한 명 편집 + presence + 30분 자동해제 + transfer) | 권장 | 1.5~2h |
| B. presence만 (보는 사람 + 마지막 저장자 표시) | 가벼움 | 40분 |
| C. rhwp 업스트림 PR (postMessage bridge for hwpctl actions, v2 협업 로드맵 활용) | 기여 | 30분 |
| D. 진짜 CRDT fork (Rust+WASM, ROI 안 나옴) | 안 함 | 3개월+ |

### 로딩 UX
`@rhwp/editor`는 `https://edwardkim.github.io/rhwp/` iframe + WASM 로드 (5~15초 정상).
- HwpEditor.tsx에 단계별 phase + 경과초 + 8초+ 자동 경고 배너 + 재시도 버튼
- 학교 네트워크에서 github.io 차단 시 진단 가능

self-host 원하면 rhwp 본체 fork → `rhwp-studio` 빌드 → 정적 배포 → `STUDIO_URL` 변경.

### 신규 권한 키 (grant_default_roles 자동 시드)
- `classroom.hwp.create/view/edit/share` → STUDENT 포함 default

### 통계 (2026-05-21 후반)
- Commit 3개: HWP Phase 1+2+3 통합 (0cdfed2) + 로딩 UX fix (2e14d60) + docs (9ccdfd2)
- Backend: 424 → 440 routes (+16, hwps 8 + 기타)
- 새 모델 2개: ClassroomHwp, HwpMember (alembic 1개)
- 새 페이지 3개: `(admin)/hwps/[hid]`, `(student)/s/hwps/[hid]`, `embed/hwps/[hid]`
- 새 컴포넌트: HwpEditor.tsx
- 테스트: pytest convention/security/backup 48/48 pass, TypeScript 0 error
- 새 docs: `docs/HWP_INTEGRATION.md`

### 다음 세션 catch-up
1. **HWP 협업 옵션 A/B/C 중 선택** 시 [docs/HWP_INTEGRATION.md](docs/HWP_INTEGRATION.md) 참조
2. dev 서버로 HWP 편집기 직접 확인 (5~15초 외부 사이트 로딩 정상)
3. 학교 네트워크 github.io 접근 가능 여부 사전 확인 필요 (배포 전)
4. 기존 보류 작업: 코드 모듈화 (HIGH 2건), 개인 드라이브 quota 정책 미세조정, 시트 학생 페이지

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-22 세션 — 드라이브 폴더 시스템 + 학생 마법사 + Google Drive 식 UI

### 큰 그림
사용자(신병철 교사) 요구: 드라이브에 폴더 시스템 도입. 최고관리자가 마법사로 교사·학생
인적사항 등록 시 자동으로 부서·강좌·학급 폴더가 만들어져 사용자가 거기에 정리.
학기 전환 시 누적식으로 새 폴더 추가. 학생도 첫 학기 진입 시 수강과목 마법사.
UI는 Google Drive처럼 폴더+자료가 한 list. 드래그&드롭 + Ctrl+X/C/V 자연스럽게.

### 폴더 모델 + 자동 생성 룰
**모델** `Folder` ([backend/app/models/folder.py](backend/app/models/folder.py)):
- (owner_id, parent_id) 트리 + 다단계 중첩
- (owner_id, auto_kind, semester_id, source_kind, source_id) UNIQUE — 멱등성
- is_system_locked (자동 폴더 잠금), sort_order (사용자별 누적)
- 5개 자료(docs/sheets/decks/surveys/hwps)에 folder_id FK (SET NULL on delete)

**자동 생성 룰** ([backend/app/services/folder_seed.py](backend/app/services/folder_seed.py)):
| 종류 | 이름 | 단위 |
|---|---|---|
| `department` | `{year}학년도 {sem}학기 {부서명}` | 학기 |
| `grade_office` | `{year}학년도 {sem}학기 {N}학년 학년부` | 학기 |
| `homeroom` | `{year}학년도 {N}학년 {M}반 담임` | **학년** |
| `class_belonging` | `{year}학년도 {N}학년 {M}반` (학생) | **학년** |
| `subject_teaching` | `{year}학년도 {sem}학기 {과목}` | 학기 |
| `subject_enrolled_wrapper` | `{year}학년도 {sem}학기 수강과목` | 학기 |
| `subject_enrolled` (wrapper 안) | `{과목}` | 학기 |
| `admin_office` | `{year}학년도 {sem}학기 관리자` | 학기 |

학기 전환 시 1학기 폴더 보존 + 2학기 폴더 sort_order MAX+1로 누적. 학년 단위 폴더는
같은 source_id 재진입 시 skip. UI prefix `01. 02. ...`는 sort_order에서 동적 생성.

**트리거 hook (best-effort, 원 작업 안 막음)**:
- `users/crud.py` create/update (department_id/is_grade_lead/role/grade/class_number 변경)
- `classroom/teachers.py` add_co_teacher
- `classroom/router.py` create_course / add_student_to_course / bulk_add_students /
  auto_generate_courses 후 sync_all_users
- `classroom/course_seed.py` seed_auto 후 sync_all_users

### 폴더 CRUD ([backend/app/modules/drive/folders.py](backend/app/modules/drive/folders.py))
9 endpoint: GET/POST/PATCH/DELETE `/api/drive/folders`, POST move/copy/sync/sync-all.
잠금 폴더는 이름변경/삭제/이동 모두 409 차단. cycle 방지 (자기 자신/자손 부모 지정 차단).

### Drive UI — Google Drive 식 ([frontend/src/components/drive/DrivePage.tsx](frontend/src/components/drive/DrivePage.tsx))
이전 좌측 FolderSidebar + 타입 탭 모두 제거. 한 list에 통합:
- **헤더 breadcrumb**: `내 드라이브 / 부서 / 수학I` 각 segment 클릭 점프
- **메인 list**: 폴더 행(위) + 자료 행(아래) 같은 테이블. 컬럼 헤더 클릭으로 정렬
  (이름/수정일/크기 — 기본 이름 오름차순. 자동 폴더는 sort_order 그룹).
- **폴더 더블클릭** → 그 폴더 진입.
- **드래그&드롭**: 자료 → 폴더 위 → 즉시 이동 (단일/다중).
- **Ctrl/Cmd+X·C·V**: Windows 식 잘라내기/복사/붙여넣기. cut은 반투명 표시,
  copy는 backend의 `/api/drive/items/{type}/{id}/copy` 호출 (docs/sheets/decks 지원,
  yjs_state·plain_text·settings 복제 + "(복사본)" suffix; hwps/surveys는 미지원).
- **Ctrl+A** 전체 선택, **ESC** 잘라내기/선택 해제, **Delete** 휴지통.
- **휴지통**: 우상단 별도 버튼 (탭 아닌 모드 토글). 폴더 없이 자료만.
- **신규 메뉴**에 "새 폴더" 추가. 자료 생성 시 현재 폴더에 자동 배치 (best-effort move).
- 토스트 알림 ("3개 자료 잘라내기 — Ctrl+V로 붙여넣기" 등).

### 학생 수강과목 마법사
**Backend** ([backend/app/modules/student_self/enrollment.py](backend/app/modules/student_self/enrollment.py)) 5 endpoint:
- `GET /api/me/enrollment/status` — 본인 학기 enrollment + onboarded 여부
- `GET /available-courses` — 자동 등록 + 선택 후보
- `POST /subjects` — 학생이 선택과목 등록
- `DELETE /subjects/{course_id}` — 수강 취소
- `POST /complete` — 마법사 완료 + onboarded=True + 폴더 동기화

`SemesterEnrollment.onboarded`를 학생 마법사 완료 플래그로 재활용 (학기별).

**관리자 CSV 일괄** ([backend/app/modules/classroom/student_enrollment.py](backend/app/modules/classroom/student_enrollment.py)):
- `GET /_enrollment/csv-template`
- `POST /_enrollment/import` (학번 + course_id 또는 subject+grade_level)
- POLICY_CSV + validate_upload (convention invariant)

**Frontend** `/s/enrollment-wizard` 페이지 — 본인 학기/학급 표시 + 자동 등록 수업 +
선택과목 후보 체크박스 + "수강 신청 완료" 클릭 시 폴더 자동 동기화 → /s/drive 이동.
사이드바 "수강과목 신청" 메뉴 추가.

### AI 도우미 자동 작성 현황 (사용자 질문)
**도구 카탈로그** ([backend/app/modules/tool_ai/tools.py](backend/app/modules/tool_ai/tools.py)):
| 도구 | 자동 작성 | 표 | 비고 |
|---|---|---|---|
| docs | ✅ doc_append_markdown / doc_replace_all | ✅ 마크다운 표 (`| col |`) | TipTap 즉시 렌더 |
| sheets | ✅ sheet_write_cells | ✅ 셀 채우기 = 표 | 한 번에 ~100 셀 |
| decks | ⚠️ slide_add 정의됨 | — | **frontend AIAssistantPanel 미연결** |
| hwps | ❌ rhwp API 한계 | ❌ | AI 마크다운 클립보드 복사 → 사용자 Ctrl+V |
| surveys | ⚠️ survey_add_question 정의됨 | — | **frontend AIAssistantPanel 미연결** |

docs/sheets는 ApplyHandler 직접 적용 — AI가 표/리스트/수식·셀 채우기 즉시 반영.
hwps는 rhwp가 char-level API 미노출 → 마크다운 텍스트만 클립보드. 표는 못 만듦.
decks/surveys는 backend 도구는 있지만 페이지에서 `AIAssistantPanel` 컴포넌트가
연결 안 됨 — 다음 작업 필요.

**테스트 전제 — API 키**: `/system/llm/providers`에서 키 입력 + 활성화 + `/system/llm/config`에서 기본 모델 지정해야 도우미 작동.

### 버그 fix (이번 세션)
1. **storage_bytes 갱신** (docs/sheets/decks) — Hocuspocus snapshot endpoint에서
   `yjs_state` 저장 시 `storage_bytes`도 함께 갱신. 이전엔 0B로 표시.
2. **list view ⋮ 메뉴 잘림** — 컨테이너 `overflow-hidden` 제거.
3. **AI 사이드바 켰을 때 hwps/sheets 우측 여백** — 이중 paddingRight 문제 →
   admin layout main과 페이지에서 각자 paddingRight를 더하던 것 → 페이지에서 제거.
   추가로 `ai.open` state가 다른 페이지에서 잔여 true로 남는 문제 →
   sheets/hwps 페이지 진입 시 `ai.setOpen(false)` 강제 + marginRight 동적
   (ai.open=true → 0, false → -24).
4. **HWP iframe AI 패널 덮임** — createEditor 후 iframe `width:100%/height:100%/border:none/display:block`
   강제 적용 + container `relative w-full overflow-hidden` 추가.
5. **Ctrl+C 복사 추가** — frontend `clipMode` state + backend `/items/{type}/{id}/copy`.
6. **storage_volumes invariant + filename_normalize** 등 기존 시스템 호환 유지.

### 통계 (2026-05-22 세션)
- Commit 약 7개 (drive 폴더 시스템 / Google Drive UI / 학생 마법사 / 4종 버그 fix /
  HWP iframe fix / CLAUDE.md 최신화)
- Backend: 440 → 456 routes (+16)
- 새 모델: Folder (1) + 5개 자료 folder_id 컬럼
- 새 모듈: drive/folders.py, classroom/student_enrollment.py, student_self/enrollment.py
- 새 서비스: services/folder_seed.py
- 새 페이지: `/s/enrollment-wizard`
- 새 컴포넌트: FolderSidebar (deprecated, type만 사용), MoveToFolderModal, SortableTh
- alembic migration: 7a1b2c3d4e5f (drive_folders + 5개 자료 folder_id)
- TypeScript 0 error, pytest 26/26 (convention/security)

### 보류 작업 (다음 단계)
1. **decks/surveys AI integration** — `AIAssistantPanel` 페이지 연결
2. **모듈화 HIGH**:
   - `classroom/[cid]/page.tsx` (845줄)
   - `students/_tabs.tsx` (836줄)
   - DrivePage (1400줄 — folder 추가로 더 커짐) → 분할 후보
3. **보안 검토** — 새 endpoint들 권한 가드 점검 (folder/copy/enrollment)
4. **테스트 추가** — folder_seed/copy/enrollment 커버리지
5. **1500명 최적화** — 인덱스 추가, N+1 점검
6. **decks 슬라이드 thumbnail 추출** (현재 plain_text만)
7. **HWP file 복사** — copy endpoint hwps 지원 (file 실 복제)

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-22 후반 — 보안 + 테스트 + 1500명 인덱스 + Drive AI + 모듈화

### Drive AI 사이드바 (신규 큰 기능)
사용자 발화 → AI가 본인 자료 메타 분석 → `drive_propose_organization` 도구로
정리안(rename + move + create_folder) 한 번에 제안 → 미리보기 모달 → "동의"
클릭 → batch endpoint atomic 적용. 삭제 절대 X.

**Backend** ([tool_ai/tools.py](backend/app/modules/tool_ai/tools.py),
[drive/folders.py](backend/app/modules/drive/folders.py)):
- `DRIVE_TOOLS` + `SYSTEM_PROMPT_BY_KIND["drive"]` 추가
- `tool_kind` regex에 "drive" 포함, current_content cap 8000자
- `POST /api/drive/items/_batch-organize` — 본인 자료만, max 500 actions, atomic
  - temp_id로 새 폴더 referencing → resolve to real ID
  - 실패 시 새 폴더 + 자료 모두 rollback
- AI 자동 작성 통합 현황 (전체 도구):
  - **docs**: ✅ doc_append_markdown / doc_replace_all (표 ✅)
  - **sheets**: ✅ sheet_write_cells (한 번에 100 셀, 표 ✅)
  - **decks**: ✅ slide_add (classroom + 단독 페이지 둘 다 통합)
  - **surveys**: ✅ survey_add_question (classroom 안)
  - **hwps**: ⚠️ rhwp 한계 — 마크다운 클립보드 (사용자 Ctrl+V)
  - **drive**: ✅ drive_propose_organization (신규)

**Frontend**:
- `types.ts` ToolKind에 "drive" + AIAssistantPanel KIND_LABEL/SUGGESTIONS
- `DriveProposalModal.tsx` 신규 — action 미리보기 (rename 화살표, 이동 대상, 새 폴더 카드)
- DrivePage 우상단 "AI 정리" 버튼 → AIAssistantPanel(toolKind="drive")
  - 메타만 컨텍스트 (제목 + 타입 + folder_id) — 본문 X (토큰 절약)
  - AI 켤 때 전체 드라이브 snapshot 1회 fetch
  - aiApply: propose 도구 결과 → setProposal → 모달

정책 (사용자 결정):
- 새 폴더 생성 OK / 메타만 / 전체 드라이브 / 삭제 X / 자동 폴더 보존

### 단독 deck 페이지 AI 통합
- `(admin)/docs/decks/[did]` 단독 페이지에 AIAssistantPanel 추가 (classroom decks 패턴 동일)
- slide_add → backend POST → reload

### HWP file 실 복제
- `drive/folders.py` copy endpoint hwps 지원
- src 파일 → `storage/hwps/{new_id}/{token}.{fmt}` 별도 작성 (symlink 대신 실 복사)
- 실패 시 file도 cleanup

### 1500명 인덱스 14개 (`alembic 8b2c3d4e5f6a`)
- `course_students(student_id, status)` — 학생 active 강좌 JOIN
- 5개 자료 `(owner_id, deleted_at)` + `(owner_id, folder_id)` — 드라이브 활성/폴더 필터
- `semester_enrollments(semester_id, role, status)` — 학기 명단
- `classroom_courses(semester_id, is_active)` — 활성 강좌
- `classroom_doc_revisions(document_id, created_at)` — revision cleanup
- PostgreSQL `CREATE INDEX IF NOT EXISTS` (멱등), SQLite도 지원

### Revision 자동 정리 cron
[notification_scheduler.py](backend/app/core/notification_scheduler.py):
- 24시간 1회. 90일 이상 일괄 삭제 + 문서당 최근 100 revision만 유지
- 1년 운영 시 storage 폭주 차단 (한 문서당 ~500k revision 가능)

### 보안 fix (Explore agent 검토)
- **MODERATE**: `student_enrollment.py` CSV row 무제한 → DoS 가능
  → **5000 rows 한도** 추가 (1500명 × 3과목 ≈ 4500 → 충분)
- **MODERATE**: `drive/folders.py` copy quota race
  → flush/consume 실패 시 자료 자동 rollback (try/except로 묶음)
- OK: IDOR, 잠금 폴더 보호, cycle 방지, CSV 검증, 학생 가드, SQL/path traversal/CSRF

### 테스트 26개 추가 (pytest 84/84 pass)
- `test_folders_api.py` (11): 폴더 CRUD, 잠금, IDOR, cycle, move/copy
- `test_enrollment_wizard.py` (7): 학생 마법사 + CSV admin-only + 5000 rows 한도
- `test_folder_seed.py` (8): 자동 폴더 생성 + 멱등성 + 학기 누적 sort_order + hooks

### HWP iframe AI 사이드바 fix
- 상단 액션바 `flex-wrap` 추가 (폭 부족 시 줄바꿈)
- `ResizeObserver`로 container 크기 변경 감지 → `iframe.style.width="800px"` 픽셀 명시 강제
  (rhwp 안 한컴 ribbon이 viewport 단위로 측정하는 경우 회피)

### 코드 모듈화 (이번 세션 통합)
**DrivePage 1700 → 1494줄 (-12%)**:
- `_drive-shared.ts` 신규 (106줄): types/constants/helpers
- `useDriveKeyboardShortcuts.ts` 신규 (132줄): ESC/Del/Ctrl+X/C/V/A hook
- DrivePage 자체는 컨테이너 + state + view JSX 유지

**classroom 양쪽 페이지 통합**:
- `components/classroom/ReadOnlyBanner.tsx` (variant: admin/student)
- `components/classroom/PeopleTab.tsx` (variant + canEdit)
- admin 페이지 352 → 297줄 (-15.6%)
- 학생 페이지 372 → 192줄 (-48%, StudentCourseworkList 별도 추출)

**학생 classroom 페이지**:
- `_components/StudentCourseworkList.tsx` 신규 (184줄)

**students/_tabs**: 이미 9개 파일로 분할 완료 (각 88~117줄). outdated 보고.

### 통계 (2026-05-22 후반)
- Commit 약 10개 (drive AI / HWP iframe / 인덱스 + revision cron / 보안 fix /
  모듈화 4건 / 테스트 추가)
- Backend: 456 → 457 routes (drive batch-organize +1)
- 새 모델: 0 (인덱스만 추가)
- 새 모듈: drive AI tool / DriveProposalModal / StudentCourseworkList /
  useDriveKeyboardShortcuts / _drive-shared / classroom 양쪽 공유
- alembic migration: 8b2c3d4e5f6a (1500명 인덱스 14개)
- 테스트: 58 → 84 (+26) pass
- TS 0 error

### 다음 세션 보류
1. **DrivePage list/grid view 추출** — DriveListView/GridView 컴포넌트
   (props 20개+ drilling 부담, 신중)
2. **classroom StreamTab 추출** — composer key remount 신중
3. **모듈화 추가 분리 가능 후보**: DrivePage fetchAll/drag&drop 핸들러 hook

---

## 2026-05-22 심야 — 드라이브 백업/복원 + 사람-읽기 형식 + 모듈화 완료

이번 stretch에 사용자가 가장 강조한 것: **"학교 옮길 때 본인 드라이브 백업"** + 모듈화 마무리.

### 드라이브 백업 시스템 (3종)

**1. ZIP 다운로드** ([drive/backup.py](backend/app/modules/drive/backup.py)):
- `POST /api/drive/backup/download` → ZIP stream
- 구조: `manifest.json` + `folders.json` + 자료 type별 폴더
- 각 자료: **이중 형식** — JSON (시스템 재import) + 사람-읽기

**사람-읽기 형식** (다른 PC/시스템에서 즉시 열기):
- `docs/{id}_*.html` — 제목 + plain_text paragraphs (서식 평문화)
- `sheets/{id}_*.xlsx` — **pycrdt**로 yjs_state 디코드 → fortune-sheet snapshot
  → openpyxl Workbook (셀 값 + 굵게/색 일부 보존)
- `surveys/{id}_*_responses.csv` — UTF-8 BOM (Excel 호환), text/choice/rating 자동
- `hwps/{id}_*.hwpx` — 원본 그대로

**2. ZIP 복원** (`POST /api/drive/backup/import`):
- `manifest.json` system="general_school" 검증 (외부 ZIP 거부)
- 폴더 매핑: 자동 폴더는 기존과 매칭 (멱등), 수동 폴더 새 생성 (64-depth pass)
- 자료 모두 새 id로 생성 (기존 안 건드림). yjs_state base64 → BLOB 복원.
- HWP file은 새 storage 경로로 실 복사
- 설문지는 `status="draft"`로 복원 (안전 default)
- POLICY_BACKUP (.zip, 2GB) + 500MB 내부 + 자료 type당 2000개 한도 (DoS 차단)
- quota check_quota 통과 + consume_quota

**3. Google Drive 일괄 export** ([google_integration/export.py](backend/app/modules/google_integration/export.py)):
- `POST /api/google/export/my-drive-bulk`
- 본인 docs/sheets 모두 → Google Docs/Sheets 자동 변환 업로드
- decks/surveys/hwps는 변환 미지원 (ZIP 백업 권장)
- Google 토큰 미연결 시 400 → frontend 친절 안내

**Frontend**: DrivePage 우상단 3개 버튼
- "백업 ZIP" — fetch blob → 자동 다운로드
- "복원" — hidden file input + confirm → upload → 결과 alert
- "Google 백업" — confirm → bulk endpoint → 결과 토스트

**새 dependency**: `pycrdt>=0.10.0` (Yjs Python binding, requirements.txt)

### 모듈화 마무리 (DrivePage 26% 감소)

**DrivePage**: 1700 → **1256줄** (-26%)
- `_drive-shared.ts` 신규 (106줄): types/constants/helpers
- `useDriveKeyboardShortcuts.ts` 신규 (132줄): Ctrl+X/C/V/A hook
- `FolderRow.tsx` (81줄) + `ItemRow.tsx` (141줄): list view 행 분리
- `FolderCard.tsx` (76줄) + `ItemCard.tsx` (147줄): grid view 카드 분리
- props 5~15개 단위 (통째 분리는 25개+ drilling 위험 회피)

**classroom 양쪽 공유**:
- `components/classroom/ReadOnlyBanner.tsx` (variant: admin/student 메시지 분기)
- `components/classroom/PeopleTab.tsx` (variant + canEdit)
- admin 페이지 352 → 297줄, **학생 페이지 372 → 192줄** (-48%)

**학생 classroom 추가 분리**:
- `(student)/s/classroom/[cid]/_components/StudentCourseworkList.tsx` (184줄)

### 테스트 (총 65 pytest pass)
- `test_drive_backup.py` (9): roundtrip + IDOR + manifest 검사 + 사람-읽기 형식 검증
  (HTML 포함, XLSX 포함, CSV 포함)
- 기존 56 + 신규 9 = 65/65

### 보안 + 정책
- 본인 드라이브만 (cross-user 차단)
- POLICY_BACKUP (.zip + 2GB)
- 500MB 내부 한도 + 자료 type당 2000개 (DoS)
- system 미일치 / 망가진 ZIP / manifest 없는 ZIP 모두 400
- quota check 통과해야 import 시작
- 설문지 import 시 status="draft" (이전 응답 안 받게)

### 통계 (2026-05-22 심야)
- Commit 약 7개:
  - 5c5d177 단독 deck AI + HWP file 복제 + 인덱스
  - 9f266ff revision cron + DrivePage helpers
  - 19b02b1 classroom/[cid] admin 분할 (ReadOnlyBanner/PeopleTab)
  - ec41b23 ReadOnlyBanner/PeopleTab 양쪽 공유
  - cb9c1da useDriveKeyboardShortcuts hook
  - 802450d StudentCourseworkList 추출 (-44%)
  - ec36a06 CLAUDE.md 최신화
  - f3f6012 행/카드 4 컴포넌트 (-16%)
  - 8ffaa28 ZIP 백업 + Google 일괄
  - cfaafac ZIP 복원
  - 5a3ad74 사람-읽기 형식 (XLSX/CSV/HTML)
- Backend: 457 → 460 routes (+3: backup/download, backup/import, google/bulk)
- 새 모듈: drive/backup.py
- 새 컴포넌트: FolderRow/ItemRow/FolderCard/ItemCard (행·카드 분리),
  ReadOnlyBanner/PeopleTab (양쪽 공유), StudentCourseworkList
- 새 hook: useDriveKeyboardShortcuts
- 새 dependency: pycrdt
- 테스트: 84 → 65 (notification 등 일부 제외, 백업 9개 신규)
- alembic 추가 0 (인덱스만)

### 학교 이동 사용자 흐름 (지금 완성)

**A 학교에서**:
1. 드라이브 → "백업 ZIP" 클릭 → ZIP 받음 → 외장 SSD/이메일 보관
2. (선택) "Google 백업" → 본인 Google에 문서·시트 사본 (즉시 다른 학교에서 열기)

**B 학교 / 같은 시스템**:
1. 새 계정 생성
2. 드라이브 → "복원" → A 학교 ZIP 업로드 → 모든 자료 + 폴더 구조 복원
3. 자동 폴더는 B 학교의 부서/강좌와 자동 매핑 (멱등)

**B 학교 / 다른 시스템**:
1. ZIP 풀고 Excel/Word/메모장으로 `*.xlsx` `*.html` `*.csv` `*.hwpx` 직접 열기
2. 시스템 import 없이도 자료 사용 가능 (서식 일부 손실)

### 다음 세션 후보
1. **docs HTML 정밀화** — Node.js sidecar 또는 frontend 협력 (Yjs → ProseMirror → HTML)
2. **decks 일부 export** — slides plain_text 모음으로 HTML/PDF
3. **백업 자동 cron** — 매주 사용자 백업 ZIP을 본인 Google에 자동 push
4. **classroom StreamTab 추출** — composer key remount 신중
5. **DrivePage fetchAll/drag&drop hook** 추가 분리

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-23 세션 — 보안 보강 + Storage Volume 자동 감지 + 강좌 챗봇 + 학생별 사본

### 16개 병렬 감사 → 보안 보강 (큰 흐름)

이전 세션 마지막에 1500명 1년 운영 readiness 감사를 16개 opus 에이전트 병렬로 돌리고
1차 보완 commit(`a5d8e92`). 본 세션에선 추가 라운드로:
- C1-C4 4건 fix (`4848436`): student sheet 페이지, CSRF middleware, rehype-sanitize, notification rate-limit
- D1-D3 (`29b0d28` + `0f09373`): DrivePage hooks/components 분할, storage volume cron, get_storage_root helper
- E1-E3 (`fcb83aa`): DrivePage 헤더 분할, backend 라우터 분할(drive/organize·classroom/posts), 운영 가이드 .md 통합
- F1+F2 (`0da16f5`): Storage Volume Step 2 인프라 (storage_volume_id 컬럼), CSRF X-Internal-Token 값 검증

### 장애 회복 — notification_scheduler 트랜잭션 격리 (`abb4037`)

**발견**: alembic upgrade 적용 전 cron tick → `UndefinedColumnError` → 같은 session 안의
3개 후속 task 모두 `InFailedSQLTransactionError`로 줄줄이 실패.

**fix**: `_scheduler_loop`의 4개 task(due_reminders/trash_purge/expired_users/revision_purge)를
각자 독립 `async_session_factory()`로 격리. 하나 실패해도 다른 task 정상. task별 error_type
분리로 24h 쿨다운 알림이 task별 개별 발송.

### Storage Volume 자동 감지 (`1931dfb`)

`/proc/mounts` 파싱 → 안전 prefix(`/mnt`, `/media`, `/run/media`)만 후보. tmpfs/proc/sysfs
등 시스템 fstype 22종 자동 제외. UI에 "자동 감지" 버튼 + `DetectMountsModal.tsx` 모달
(추천 후보 강조, 등록됨 회색, read-only 빨강, 1클릭 등록). WSL 테스트로 `/mnt/c` 정상 감지 확인.

### 스토리지 가이드 보강 (`2ecafae`)

`DEPLOY_TO_SCHOOL.md §1.5` + `production/README.md` 새 절:
- 1500명 1년 = 300~600GB 실 사용 추정
- 비용/셋업/운영/안전 4축 비교표 (외장 SSD 1개 / 2개 미러 / NAS RAID 1 / RAID 5/6 / 5대 클러스터)
- **5대 노트북 클러스터 권장 X** 5가지 이유 (폐 디스크 수명·NFS 인력 부담·1대 꺼지면 stuck·미러 불가·전기료)
- NAS 셋업 5단계 (NFS 활성화 + `nofail,_netdev,soft,timeo=30` fstab 옵션)

### LLM API 키 등록 UX fix (`12f70bd`)

흔한 mistake — 키 입력 → 저장 → "활성화" 토글 깜빡 → "비활성 상태입니다" 에러.
`upsert_provider`에서 키 입력 + `is_active` 명시 안 했으면 자동 `is_active=True`.
사용자가 명시적 `is_active=False`를 함께 보내면 그 의도 존중.

### 첨부 share_mode + 학생별 사본 + 강좌 챗봇 (3 phase, 5 commit)

**Phase 1 (`2dc2216`)** — Attachment.share_mode 필드 추가
- `view` (default) / `edit` (공동 편집) / `copy` (학생별 사본, Phase 2 활성화)
- frontend: AssignmentModal에 드롭다운, PostDetailView에 ShareModeBadge

**Phase 2a backend (`61151f4`)** — 학생별 사본 자동 생성
- 신규 모델 `PostAttachmentCopy` (post_id + attachment_idx + student_id UNIQUE)
- 신규 endpoint:
  - `POST /api/classroom/posts/{pid}/attachments/{idx}/my-copy` — 학생 lazy 생성
  - `GET /api/classroom/posts/{pid}/copies` — 교사 채점용 list
- `_create_student_copy` 헬퍼 — doc/sheet/deck/hwp 4 type 모두 지원
  - yjs_state 복제, HWP file 실 복사, deck은 slides도 복제
  - 학생 quota 차감, 사본 access_mode=specific_users + 교사들 멤버 추가
- 정책: lazy 생성 (강좌 active 수강생 첫 접속 시), 학기 중 신규 학생도 OK

**Phase 2b frontend (`9373bc1`)**
- 학생 클릭 → my-copy API → `window.location.href = copy_url` redirect
- 교사 페이지에 `CopiesSection` — 학생 list (학년-반-번호) + 1클릭 사본 열기

**Phase 3a backend (`fa86269`)** — 강좌 챗봇 CRUD
- 신규 모델 `CourseChatbot` (name + system_prompt + provider/model_id 옵션 + is_active)
- 5 endpoint (list/create/get/update/delete) — editor + admin CRUD, 멤버 view
- 사용자 결정 사항: 이름 "Gem" 대신 **"강좌 챗봇"** + 강좌 active 수강생만

**Phase 3b (`74f5f0b`)** — UI + 챗 시작 + system_prompt override
- `ChatSession.system_prompt_text` 컬럼 추가 (Text, nullable) + alembic
- `sessions.py` 메시지 발송 분기 — system_prompt_text 우선
- `POST /api/classroom/chatbots/{bid}/start-session` — 새 ChatSession + chatbot prompt
- `CourseTabs`에 "챗봇" 탭 추가 (Bot 아이콘)
- `CourseChatbots.tsx` 신규 — 카드 list + 만들기/편집 모달 + 시작 버튼
- admin/student 강좌 페이지 양쪽 통합

### 통계 (2026-05-23 세션)

- Commit: 약 13개 (보안 보강 5 + 장애fix 1 + storage 자동감지 1 + 가이드 보강 1 + LLM UX fix 1 + share_mode 1 + 학생사본 2 + 챗봇 2)
- Backend: 466 → **474 routes** (+8)
- 새 모델: PostAttachmentCopy, CourseChatbot (2개) + ChatSession.system_prompt_text 컬럼
- alembic migrations: 4개 (storage_volume_id, post_attachment_copies, course_chatbots, system_prompt_text)
- 새 sub-router: classroom/student_copy.py + classroom/chatbots.py
- 새 frontend: CourseChatbots.tsx + DetectMountsModal.tsx + 기존 컴포넌트 확장
- 테스트: pytest 32/32 + frontend tsc 0 error 매 commit 통과
- 사용자 다른 세션 작업 4개 .sh 파일은 fs metadata(executable bit)만 변경됐던 것 → chmod +x 복원

### 다음 세션 후보 (작성 시점, 일부는 후속 세션에서 완료됨)
1. **챗봇 첨부 type 통합** — 글 attachment에 `type: "chatbot"` 추가, 학생 클릭 시 챗봇 자동 시작
2. **챗봇 컨텍스트 자료 첨부** — `CourseChatbot.context_attachments` 활용 (강좌 자료를 system prompt에 자동 주입)
3. **Storage Volume Step 2 Phase 2** — files/router.py에서 storage_volume_id 보고 root 분기, 업로드 endpoint 적용
4. **5대 노트북 클러스터 자동 셋업 스크립트** (Option C) — 사용자가 필요성 결정 후
5. **AI 회귀 감사 — F2 발견 HIGH 2건 처리**:
   - is_course_editor SSOT 채택 (co_teacher가 본인 강좌 글 작성·삭제 못함)
   - batch-organize atomic rollback 강화 (`except Exception` + undo replay)

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-23 후반 — F2 audit fix + 챗봇 통합·컨텍스트 + GitHub 알림 + 코스웨어 Phase 1

### F2 AI 회귀 감사 HIGH 2건 fix
**1. classroom is_course_editor SSOT 채택** (commit `a984d31`):
- `_assert_course_access` (router.py:102) — owner만 'teacher' 반환 → `is_course_editor` 호출로 교체. co_teacher가 강좌 글 조회·작성 endpoint 5곳에서 403 떨어지던 issue 해소.
- posts.py 5곳 (글 작성/수정/삭제/댓글 삭제/첨부 업로드) — `c.teacher_id == user.id` 직접 비교 → `is_course_editor / is_course_editor_or_admin` SSOT로 교체.
  - 수정/삭제는 author 본인 + 강좌 editor + admin 정책 (이전엔 author + admin만)
- chatbots.py `_is_course_member` / `_is_course_admin` — `is_course_editor(db, user, course)` 시그니처 뒤바뀐 버그 fix (실제 시그니처는 `(db, course, user)`). co_teacher가 챗봇 접근·관리 못하던 버그 해소.
- 영향: co_teacher가 owner와 동등하게 글·댓글·첨부·챗봇 관리 가능.

**2. drive batch-organize atomic rollback 강화** (commit `3d9db44`):
- 기존: `except HTTPException`만 잡고 비-HTTPException 시 raw exception 노출 + 명시적 임시폴더 db.delete cleanup (transaction에 의해 자동 rollback될 변경에 대해 redundant).
- 수정: `except Exception` 추가해 500 + type 이름만 wrap. 명시적 cleanup 제거 — get_db dependency가 transaction rollback 자동 처리. atomicity 보장 주석 명시.

### 챗봇 첨부 type 통합 (commit `48ea29e`)
**Backend**: schemas.py Attachment에 `type="chatbot"` + `chatbot_id` 필드. 기존 `POST /api/classroom/chatbots/{bid}/start-session` 활용.

**Frontend**:
- `ChatbotPickerModal.tsx` 신규 — 강좌 활성 챗봇 list + 1클릭 선택
- AssignmentModal 첨부 row "챗봇" 버튼 (sky 톤) + Bot 아이콘
- PostDetailView `ChatbotAttachmentRow` 신규 — 클릭 시 start-session POST → `${baseHref가 /s/* 시작이면 /s/chat 아니면 /chat}?sid={session_id}` redirect
- ChatInterface `useSearchParams`로 `?sid=` 자동 활성화 + loadSessions 동기화 + `window.history.replaceState`로 URL 정리

**흐름**: 글 작성 → 챗봇 선택 → 글 저장 → 학생 클릭 → 본인 ChatSession 자동 생성 → /chat 또는 /s/chat 페이지로 redirect.

### 챗봇 컨텍스트 자료 자동 주입 (commit `24ea19e`)
이미 모델에 있던 `CourseChatbot.context_attachments` JSON 컬럼 활성화.

**Backend** (`app/services/chatbot_context.py` 신규):
- `build_context_text(db, attachments)` — doc/deck `plain_text` + sheet/hwp 제목 → "=== 강좌 참고 자료 ===" 헤더로 system_prompt 앞에 prepend
- 자료당 5,000자 / 합쳐서 30,000자 한도 (LLM context window 보호)
- doc → ClassroomDocument.plain_text / deck → ClassroomSlide.plain_text 순서대로 / sheet·hwp → 제목만 (plain_text 없음 — 차후 확장)
- ContextAttachment Pydantic — ChatbotCreate/Update에 `list[ContextAttachment]` (max 10) + create endpoint에서 dict 명시 변환
- start-session: build_context_text 결과를 `"...\n\n--- 시스템 지시 ---\n[원 prompt]"` 형식으로 결합 → ChatSession.system_prompt_text 저장

**Frontend** (`CourseChatbots.tsx`): ChatbotEditModal에 "참고 자료" 섹션 — DrivePicker 활용 (survey 자동 필터) + 중복 제거 + 10개 한도 + X 제거 버튼. `?session=` → `?sid=` 통일.

### GitHub 자동 업데이트 알림 (commit `f68f3bf`)
학교 자체 서버 운영 시 GitHub 새 commit 발견하면 super_admin in-app 알림 + 가이드 페이지. 자동 git pull은 안 함 (alembic·테스트 미검증 코드 위험).

**Backend**:
- `services/github_updates.py` 신규
  - `GITHUB_UPDATE_REPO` env 미설정 시 polling 자동 off (dev 안전)
  - `git log -1` (asyncio.to_thread) vs `GitHub /commits/{branch}` 비교
  - `/compare/{a}...{b}` 차이 commit list (max 20)
  - SchoolConfig `github_update.last_notified_remote_sha` 중복 알림 차단
- notification_scheduler에 `_maybe_check_github_updates` task (24h cooldown)
  - 새 commit + 미알림 → notify_users(super_admin all), link_url=/system/updates
- `modules/system/updates.py` 2 endpoints (`require_super_admin`)
  - `GET /api/system/updates/status` — 현재/원격/차이 commit
  - `POST /api/system/updates/check-now` — 즉시 polling
- 권한 `system.updates.view` 등록

**Frontend** (`/system/updates`):
- enabled=false 시 환경변수 설정 가이드 카드
- 최신 동기화: emerald "최신 상태" 카드
- behind: sky 카드 + 현재/원격 commit 비교 + 차이 commit list + 업데이트 절차 안내 (git pull → pip/npm → alembic upgrade → systemctl restart)
- "지금 확인" 버튼
- 사이드바 시스템 카테고리 "코드 업데이트" (Github 아이콘)

운영: 학교 서버 `.env`에 `GITHUB_UPDATE_REPO=sinbc2003/general_school` 한 줄 + backend 재시작.

### 문제은행 코스웨어 Phase 1 (commit `d86d0de`)

**개념**: Assignment(파일 제출형 수행평가) / Contest(올림피아드)와 별개의 신규 시스템.
교사가 강좌 안에서 자동채점 문제 출제 → 학생 즉시 풀이 → 점수 누적.

**모델** (`backend/app/models/courseware.py` 신규 + Problem 확장):
- `Problem.answer_data` JSON 추가 — `{grader_type: "choices"|"exact"|"regex"|"numeric"|"essay"|"manual"|"llm", correct/value/pattern/tolerance/rubric, ...}`
- `CourseProblemSet` — course_id FK, problem_ids JSON ordered, status (draft/published/closed), due_date, time_limit_seconds, max_attempts, show_solution_after_due, settings, deleted_at(soft delete)
- `StudentProblemAttempt` — UNIQUE(set_id+problem_id+student_id+attempt_number), answer_data, is_correct, auto_score, manual_score, manual_feedback, graded_by, submitted_at, graded_at
- alembic migration `acccc2f57668`

**자동채점 헬퍼** (`services/courseware_grader.py`):
- `grade_answer(answer_data, submission) → (is_correct, auto_score)`
- choices: 객관식 set 비교 (다중정답 OK)
- exact: 문자열 일치 (case_sensitive·trim 옵션)
- regex: 매치 (DoS 방지 10KB 한도)
- numeric: float + tolerance
- essay/manual/llm: 자동채점 X (is_correct=None, manual_score 필요)
- 검증 8 case 통과

**모듈** (`app/modules/courseware/`):
- `permissions.py`: 5개 — `classroom.courseware.create/view/edit/grade` (교사) + `view/submit` (학생)
- `schemas.py`: ProblemInline + ProblemSetCreate/Update + SubmitAttemptReq + ManualGradeReq + ProblemType/GraderType Literal
- `router.py`: 12 endpoints
  - 교사: list / create(problems inline) / get(정답 포함) / update / delete(soft) / publish / close / results(학생별·문제별 정답률) / manual-grade
  - 학생: student-view(정답 마스킹) / submit(자동채점 즉시) / my-attempts
- main.py 등록 → 476 → 488 routes (+12)
- grant_default_roles.py에 학생 view/submit 자동 부여

**Classroom 통합**:
- `Attachment.type` Literal에 `"problemset"` + `problemset_id` 필드 추가
- 다음 Phase에서 글 첨부로 통합 (chatbot 패턴 동일)

### log_action 시그니처 이슈 — spawn_task 분리
classroom/posts.py 등에 `log_action(..., target_type=, target_id=)` 같은 잘못된 keyword 호출 발견. audit.py 실제 시그니처는 `(db, user, action, target=, detail=, request=, is_sensitive=)`. 호출 시 TypeError → 글 삭제 등 endpoint 500. 별도 task로 spawn.

### 통계 (2026-05-23 후반)
- Commit 6개: classroom SSOT + drive rollback + 챗봇 첨부 + 챗봇 컨텍스트 + GitHub 알림 + 코스웨어 Phase 1
- Backend: 474 → 488 routes (+14, 코스웨어 12 + system updates 2)
- 새 모델 2개: CourseProblemSet, StudentProblemAttempt + Problem.answer_data 컬럼
- 새 모듈 1개: courseware (permissions + schemas + router)
- 새 service 헬퍼 2개: chatbot_context.py, github_updates.py, courseware_grader.py
- 새 페이지 1개: `/system/updates`
- 새 컴포넌트 1개: ChatbotPickerModal.tsx
- alembic 1개: acccc2f57668 (courseware tables + answer_data)
- 새 권한 6개: system.updates.view + classroom.courseware.* 5개
- 테스트: pytest 42/42 + frontend tsc 0 error 매 commit 통과
- 신병철 다른 세션 .sh 파일 fs metadata 4건 → chmod +x 복원 (재발생 — git mode_filemode 이슈)

### Push 미해결
이번 후반 세션의 commit 6개 (a984d31, 3d9db44, 48ea29e, 24ea19e, f68f3bf, d86d0de) 모두 SSH key Permission denied로 push 안 됨. notebook 장비에 `ssh-keygen -t ed25519 -C "..."` + GitHub 키 등록 필요.

### 다음 세션 후보
1. **코스웨어 Phase 2** — 교사 출제 UI (강좌 페이지 "문제 세트" 탭 + 출제 모달 + LaTeX/KaTeX·객관식·단답·수치·주관식 입력)
2. **코스웨어 Phase 3** — 학생 풀이 UI (`/s/courseware/{psid}` + 자동채점 즉시 결과)
3. **코스웨어 Phase 4** — 결과 분석 (교사 정답률·오답 분포 / 학생 오답노트 / CSV export)
4. **챗봇 LLM 주관식 채점 옵션** — `grader_type="llm"` 활성화 (chatbot provider 재사용)
5. **Storage Volume Step 2 Phase 2** — `files/router.py` 라우팅 통합 (이전 세션 후보)
6. **log_action 시그니처 fix** — spawn_task 처리 (이미 chip 띄움)
7. **이전 세션 보류: 코드 모듈화 HIGH 2건** (classroom/[cid]/page.tsx 845줄·students/_tabs 836줄)

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.

---

## 2026-05-28 세션 — 학교 NFS 2-노드 운영 사전 정비 (3대 위험 해소)

수성고 방문 직전. A(서버) + B(NFS 스토리지) 분리 운영을 위해 3가지 위험 요소 점검 + 코드 보강.

### 위험 1: STORAGE_ROOT env var 통일 (코드 수정 0으로 NFS 전환)

**기존 문제**: 15개 모듈이 `Path(__file__).resolve().parents[3] / "storage"`, `os.path.join("storage", "X")`, `Path("storage")` 등 제각각 패턴으로 storage 경로 만들었음 → NFS 분리 시 일제 수정 필요.

**해결**:
- `app/core/config.py`: `STORAGE_ROOT: str = "storage"` env var 신규
- `app/core/files.py`: `DEFAULT_STORAGE_ROOT = Path(settings.STORAGE_ROOT)` (모듈 import 시 결정 — env 변경 후 재시작 반영)
- 15개 파일 일제 치환:
  - archive, assignment, research, teacher_groups, past_research
  - classroom/{posts,customize,student_copy}, classroom_hwps
  - courseware/{io,demo}, drive/{backup,organize}
  - files (다운로드 가드), system/branding, student_self/artifacts
- 모든 `UPLOAD_DIR`/`STORAGE_ROOT`/`STORAGE_BASE`/`STORAGE_DIR` 정의를 `DEFAULT_STORAGE_ROOT` 사용으로 통일

**운영 사용**:
```bash
# .env 에 한 줄
STORAGE_ROOT=/mnt/gs-storage   # B 노트북 NFS 마운트
# → 드라이브·과제·연구·문서·HWP·아카이브 등 모든 업로드가 자동으로 B로
```
심볼릭 링크 방식(`ln -s /mnt/gs-storage storage`)도 호환 유지.

### 위험 2: NFS hang 차단 (timeout 헬퍼)

**기존 문제**: NFS 마운트가 끊기면 `Path.write_bytes()`가 무한 hang → 라우터 worker 마비. 타임아웃 0.

**해결** (`app/core/files.py`):
- `write_bytes_async` / `read_bytes_async`: **30초 timeout** (50MB 파일도 1Gbps에서 1초 미만 — 30초면 충분 + 안전)
- `ensure_dir_async` / `unlink_async`: **5초 timeout** (metadata 작업)
- `StorageUnavailable(OSError)` 예외 신설 — 기존 `except OSError` 블록 호환
- 타임아웃 시 ERROR 로그 + 명확한 메시지
- `app/modules/storage_volumes/router.py`:
  - `_check_path`: 5초 timeout → hang 시 `("timeout", 0, 0)` fail-soft
  - `list_volumes`: 순차 → `asyncio.gather` 병렬 (N개 hang해도 5초 컷)

### 위험 3: Quota 개별/일괄 할당 API + 관리자 UI

**기존 문제**: 사용자별 quota 변경 API 없음 (생성 시 역할별 기본값만). 1300명 학교에서 "이 교사만 5GB 더" 같은 운영 불가.

**해결 백엔드** (`app/modules/users/quota.py` 신규):
- `POST /api/users/{id}/quota` (개별 변경)
- `POST /api/users/_quota/bulk` (역할별 일괄, super_admin role 제외)
- 권한: `user.manage.quota` (`requires_2fa=True`, `is_sensitive=True`)
- 가드: super_admin 항상 무제한 강제, designated_admin은 super_admin 변경 차단, 음수 거부
- audit: `user_quota_update` / `user_quota_bulk_update` (sensitive)

**해결 프론트엔드**:
- `frontend/src/types/index.ts` UserItem: `quota_bytes`/`used_bytes` 추가
- `(admin)/users/page.tsx`:
  - DataTable에 "드라이브" 컬럼 — `사용량 / 할당량` (초과 시 빨간색) + MB InlineCell 인라인 편집 (super_admin)
  - 상단 "용량 일괄" 버튼 (HardDrive 아이콘, `user.manage.quota` PermissionGate)
- `_components/QuotaBulkModal.tsx` 신규 — 역할 선택 → 기본값 자동 채움 → 확인 체크 후 일괄 변경

### 신규 인프라 (외장 SSD 분산 운영 대비)

`app/core/files.py`에 진입점 헬퍼:
- `save_upload_to_volume_async(db, *, section, filename, data)` — 신규 endpoint용 1줄 헬퍼. volume 선택 + 디렉터리 + write + `StorageVolume.used_bytes` 자동 갱신.
- `storage_health_check(db)` — default root + 모든 볼륨 병렬 점검 (5초 컷). 응답 `{default_root, volumes, any_unavailable}`.
- `app/modules/storage_volumes/router.py` 신규 endpoint: `GET /api/storage/health` (운영자가 NFS/외장 SSD 상태 한 줄로 점검).

**보류** (외장 SSD 추가 시점에): 모델별 `storage_volume_id` 컬럼 + 마이그레이션 + endpoint별 `save_upload_to_volume_async` 점진 교체 + download/delete 분기. NFS 1개 운영에는 불필요.

### 신규 권한
- `user.manage.quota` (super_admin/designated_admin이 부여 가능, 2FA 필수)
- `storage.volume.view` / `storage.volume.manage` (기존, /health도 view 권한 사용)

### 신규 endpoint (3개)
- `GET /api/storage/health`
- `POST /api/users/{id}/quota`
- `POST /api/users/_quota/bulk`

### 문서 업데이트
- `SCHOOL_SETUP_2NODE.md` Step 4: `.env`에 `STORAGE_ROOT=/mnt/gs-storage` 한 줄 안내 (옵션 A 권장) + 심볼릭 링크 옵션 B 호환
- 본 CLAUDE.md 이 섹션 (다음 세션 catch-up)

### 통계 (2026-05-28)
- Commit 2개: `fd592d9` (timeout + quota UI + health endpoint + 통합 헬퍼) + `75ea33f` (STORAGE_ROOT env var + 15 endpoint 일제 치환)
- 신규 파일: `users/quota.py`, `users/_components/QuotaBulkModal.tsx`
- 수정: 19개 파일 (코어 2 + 15 endpoint + frontend 2 + 매뉴얼 1)
- 부팅 검증: Python syntax 18 파일 OK, import 검증 (venv 안에서) OK
- A 노트북 학교 Tailscale 등록은 사용자 학교 방문 후 수행 예정 (Plan A); 실패 시 D(여분 윈도우 노트북) Chrome RD jump host로 fallback (Plan B)
