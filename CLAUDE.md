# General School 통합 플랫폼

## 개요
교사/학생 통합 학교 관리 플랫폼. gshs_teacher + gshs_student를 하나로 병합한 일반 학교용 버전.

## 개발 정책 (AI 개발자 필독)

**이 프로젝트는 Claude Code(또는 동일 계열 AI)로 계속 개발됩니다.**
새 기능 추가 시 아래 보장을 반드시 지킬 것:

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
- `alembic/versions/` — 과거 마이그레이션 절대 수정 X (새 revision만 추가)
- `app/models/__init__.py` — 모델 등록 (백업 일관성 보장)
- `frontend/src/components/ui/*` — 6개 페이지가 공유, 시그니처 변경 신중

## 기술 스택
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: FastAPI + async SQLAlchemy 2.0 + PostgreSQL/SQLite
- **인증**: 비밀번호 + JWT + TOTP 2FA

## 실행 방법

### Backend (포트 8002, SQLite 개발용)
```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="sqlite+aiosqlite:///general_school.db" python -m uvicorn app.main:app --host 0.0.0.0 --port 8002
```

### Frontend (포트 3000)
```bash
cd frontend
npm install
npm run dev
```

## 초기 계정
- **최고관리자**: adminssh / 19550425!@!@

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
