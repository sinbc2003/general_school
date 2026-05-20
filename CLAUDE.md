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
start-backend.bat   # WSL bash 호출 → uvicorn (.env 자동 로드)
start-frontend.bat  # WSL bash 호출 → next dev
```

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

다음 세션 catch-up: 이 CLAUDE.md만 읽으면 OK.
