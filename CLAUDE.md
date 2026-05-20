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
