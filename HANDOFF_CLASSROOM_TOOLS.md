# 클래스룸 도구 — 인수인계 (Handoff)

> **새 세션이 이 문서 하나만 읽고 작업 시작할 수 있도록 self-contained.**
> 작성: 2026-05-19 / 작성자: 신병철 + Claude
> 진행 시: CLAUDE.md (프로젝트 가이드)와 본 문서를 함께 읽고 시작.

---

## 0. 목표

[`/classroom` 모듈](backend/app/modules/classroom/) (MVP 완료) 위에 **Google Classroom 식 도구 2종** 추가:

1. **협업 문서** (Google Docs 식 동시 편집) — Yjs + TipTap + Hocuspocus
2. **설문지** (Google Forms 식) + **단축 링크** + **QR 코드** — 자체 구현

학교에서 즉시 활용:
- 교사가 강좌별로 협업 문서 만들어 학생들이 동시 편집 (조별 발표 자료, 토론 정리 등)
- 수업 중 설문 즉시 만들어 단축 링크 또는 QR로 학생들에게 배포 (이해도 체크, 의견 수렴, 평가)

---

## 1. 의사 결정 (확정)

### 협업 문서 — Yjs 스택

| 도구 | 역할 | 위치 |
|---|---|---|
| **Yjs** | CRDT 협업 알고리즘 (충돌 없는 동시 편집) | npm — frontend |
| **TipTap** | React 에디터 (글자 굵게·기울임·헤딩 등 UI) | npm — frontend |
| **Hocuspocus** | Yjs 동기화 서버 | **Node.js sidecar** (별도 process) |

**왜 이 스택**:
- Notion / Linear / GitBook 등이 사용. 사실상 표준.
- 학교 LAN 80명 동시 편집 무리없음.
- Yjs는 오프라인 편집 후 sync 가능 (CRDT 특성).
- 우리 Next.js + React 스택과 자연 통합.

**대안 검토 후 기각**:
- Etherpad: iframe 통합 어려움, 디자인 일관성 깨짐
- OnlyOffice: 4GB+ RAM 필요, 학교 환경 과함
- 자체 OT: 안정성 risk, 동시 편집 시 충돌

### 설문지 — 자체 구현

- 단답형 / 장문 / 객관식(라디오) / 체크박스 / 평점(1-5) / 날짜
- 단축 링크: `/q/{slug}` (6자리 base62)
- QR 코드: server-side 생성 (`qrcode` 패키지 → PNG bytes)

**왜 자체 구현**:
- SurveyJS 같은 라이브러리는 디자인·권한 통합 부담 큼
- 단순한 모델로 학교 시나리오 충분 (단답형~체크박스 정도)
- 단축 링크·QR이 핵심이라 외부 솔루션은 어차피 wrapper 필요

---

## 2. 아키텍처 개요

### Backend

```
backend/app/modules/
  classroom/          # 기존 — Course/CourseStudent/CoursePost
  classroom_docs/     # 신규 — Document, DocumentRevision
  classroom_surveys/  # 신규 — Survey, Question, Response, Answer
  classroom_links/    # 신규 — ShortLink (설문·문서 공유용)
```

### Hocuspocus 서버 (sidecar)

```
backend-hocuspocus/    # 신규 Node.js 프로젝트
  package.json
  server.ts            # Hocuspocus 메인
  auth.ts              # FastAPI JWT 검증
  storage.ts           # 주기적 snapshot → backend API POST
```

**운영**: systemd service 또는 `npm run` (개발). 학교 환경에서는 PM2 권장.
**포트**: `1234` (Hocuspocus 기본), nginx/Caddy로 `/yjs` path proxy.

### Frontend

```
frontend/src/
  app/(admin)/classroom/[cid]/
    docs/page.tsx          # 강좌 협업 문서 목록
    docs/[did]/page.tsx    # 협업 문서 편집기
    surveys/page.tsx       # 설문 목록
    surveys/[sid]/page.tsx # 설문 편집/응답 수집
    surveys/[sid]/results/page.tsx  # 응답 결과 차트
  app/(student)/s/classroom/[cid]/
    docs/[did]/page.tsx    # 학생 협업 편집
    surveys/[sid]/page.tsx # 학생 응답 폼
  app/q/[slug]/page.tsx    # 단축 링크 (익명 OK, 권한 가드는 내부)
  components/docs/
    CollabEditor.tsx       # TipTap + Yjs provider 통합
  components/surveys/
    SurveyForm.tsx         # 응답자용
    SurveyBuilder.tsx      # 작성자용 (드래그·드롭 X, 단순 list)
    SurveyResults.tsx      # 결과 차트
```

---

## 3. 데이터 모델

### 협업 문서

```python
# backend/app/models/classroom_docs.py

class Document(Base):
    """협업 문서. 강좌 또는 단독 (course_id null)."""
    __tablename__ = "classroom_docs"
    id: Mapped[int]
    course_id: Mapped[int | None]  # FK to classroom_courses (null이면 personal)
    owner_id: Mapped[int]  # FK to users (작성자, 항상 편집 가능)
    title: Mapped[str]  # String(255)
    # Yjs 이진 상태 (Y.Doc.encodeStateAsUpdate). bytea 또는 base64 text.
    yjs_state: Mapped[bytes | None]  # 또는 LargeBinary
    # 사람이 읽을 수 있는 fallback (검색용, 주기적으로 yjs → text 변환 저장)
    plain_text: Mapped[str | None]  # Text, 색인 가능
    # 권한 모드
    access_mode: Mapped[str]  # "course_members" | "specific_users" | "link_public"
    is_archived: Mapped[bool]
    created_at, updated_at: Mapped[datetime]

class DocumentMember(Base):
    """access_mode='specific_users'일 때 사용. course_members면 자동으로 강좌 멤버."""
    __tablename__ = "classroom_doc_members"
    id, document_id, user_id, role  # role: "editor" | "viewer"

class DocumentRevision(Base):
    """주기적 snapshot (롤백·복원·감사). Hocuspocus가 hook으로 저장."""
    __tablename__ = "classroom_doc_revisions"
    id, document_id, yjs_state, plain_text, created_at, created_by_id
```

### 설문지

```python
# backend/app/models/classroom_surveys.py

class Survey(Base):
    __tablename__ = "classroom_surveys"
    id: Mapped[int]
    course_id: Mapped[int | None]  # FK to classroom_courses
    author_id: Mapped[int]
    title: Mapped[str]
    description: Mapped[str | None]
    status: Mapped[str]  # "draft" | "active" | "closed"
    is_anonymous: Mapped[bool]  # True면 응답자 신원 안 저장
    allow_multiple_responses: Mapped[bool]
    open_at, close_at: Mapped[datetime | None]
    # access_mode: "course_members" | "link_public" | "specific_users"
    access_mode: Mapped[str]
    created_at, updated_at: Mapped[datetime]

class SurveyQuestion(Base):
    __tablename__ = "classroom_survey_questions"
    id, survey_id, order: int
    question_text: Mapped[str]
    question_type: Mapped[str]  # short_text | long_text | single_choice | multi_choice | rating | date
    is_required: Mapped[bool]
    options: Mapped[list | None]  # JSON list (객관식·체크박스용)
    rating_max: Mapped[int]  # 평점 최댓값 (기본 5)

class SurveyResponse(Base):
    __tablename__ = "classroom_survey_responses"
    id, survey_id
    respondent_id: Mapped[int | None]  # 익명이면 null
    submitted_at: Mapped[datetime]
    # IP / user agent는 익명 시 응답 추적 방지를 위해 hash만 저장 (중복 방지)
    response_hash: Mapped[str | None]

class SurveyAnswer(Base):
    __tablename__ = "classroom_survey_answers"
    id, response_id, question_id
    text_value: Mapped[str | None]  # short/long_text/date
    choice_values: Mapped[list | None]  # JSON list (single은 1개, multi는 N개)
    rating_value: Mapped[int | None]
```

### 단축 링크

```python
# backend/app/models/classroom_links.py

class ShortLink(Base):
    __tablename__ = "classroom_shortlinks"
    id, slug: Mapped[str]  # 6자리 base62 — String(16), unique
    target_type: Mapped[str]  # "survey" | "document"
    target_id: Mapped[int]
    created_by_id, created_at
    expires_at: Mapped[datetime | None]
    click_count: Mapped[int]
    # slug 자동 생성: 6자리 → 충돌 시 7, 8자리 재시도
```

---

## 4. 단계별 작업 카드

> 각 단계는 **commit 1회로 끝나는 단위**. 의존성 명시. 안전망 체크리스트.

### Phase A — 협업 문서 모델 + 단독 편집기 (Yjs 없이)

**산출물**:
- 모델 3개 (Document, DocumentMember, DocumentRevision) + alembic migration
- `app/models/__init__.py` import 등록
- 권한 키 4개: `classroom.doc.create / edit / view / share`
- `app/modules/classroom_docs/` 모듈 (router, schemas, permissions)
- API: 생성 / 편집 (단일 사용자) / 조회 / 삭제 / 공유 모드 변경
- frontend `(admin)/classroom/[cid]/docs/page.tsx` + `[did]/page.tsx`
- TipTap 단독 사용 (Yjs 없이)
- 권한 가드: 강좌 멤버 정책 + DocumentMember 조회

**npm 패키지 추가** (frontend):
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder
```

**의존성**: Phase A는 다른 단계와 독립. 가장 먼저.

**완료 조건**:
- 교사가 강좌에서 문서 생성 → 편집 → 저장
- 학생이 read-only로 조회 (access_mode에 따라 편집 가능)
- pytest convention invariants 통과
- 90+ 테스트 모두 통과

---

### Phase B — Yjs + Hocuspocus 실시간 협업

**산출물**:
- `backend-hocuspocus/` Node.js 프로젝트 신규
  - `package.json`: hocuspocus, ws, jsonwebtoken
  - `server.ts`: WebSocket 서버 (포트 1234)
  - `auth.ts`: 클라이언트 보낸 JWT 검증 (우리 JWT_SECRET 공유)
  - `storage.ts`: 1분마다 Yjs state → FastAPI에 POST (Document.yjs_state 갱신)
  - `permissions.ts`: 문서 권한 가드 (FastAPI에 권한 조회 API 호출)
- backend 신규 endpoint:
  - `GET /api/classroom/docs/{did}/yjs-snapshot` — Hocuspocus 로딩 시
  - `POST /api/classroom/docs/{did}/yjs-snapshot` — 주기 저장 (Hocuspocus only, 내부 토큰 인증)
- frontend `CollabEditor.tsx`:
  - `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-cursor`
  - `y-websocket` provider → `ws://localhost:1234/?doc={did}`
- 사용자 presence (커서 + 이름 + 색깔)
- 운영 문서: `backend-hocuspocus/README.md` (시작 명령, systemd 예시)

**npm 패키지 추가** (frontend):
```bash
npm install yjs y-websocket @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor
```

**npm 패키지** (backend-hocuspocus):
```bash
npm install @hocuspocus/server @hocuspocus/extension-database axios jsonwebtoken
```

**의존성**: Phase A 완료 후.

**완료 조건**:
- 두 브라우저 탭에서 같은 문서 동시 편집 → 충돌 없이 sync
- 다른 사람 커서 보임 (presence)
- 권한 없는 사용자가 WS 접속 시 즉시 disconnect (auth fail)
- backend 재시작해도 Hocuspocus의 in-memory 상태가 DB snapshot에서 복원
- SETUP.md 보강 (Hocuspocus 시작 절차)

**운영 critical**:
- Hocuspocus 서버가 죽으면 협업 불가. systemd auto-restart 설정.
- 학교 LAN 환경: 외부 노출 X (학교 내부 WS만)
- 백업: Yjs state는 `Base.metadata.sorted_tables`로 자동 백업됨 (LargeBinary 컬럼)

---

### Phase C — 강좌 통합 (협업 문서 ↔ Course)

**산출물**:
- 강좌 상세 페이지에 "협업 문서" 탭 추가
- `course_id`로 문서 자동 필터링
- 새 문서 만들 때 강좌 자동 연결 + access_mode="course_members" 기본값
- 강좌 학생 자동으로 viewer/editor 권한
- backend는 access_mode="course_members"일 때 CourseStudent 조회로 가드

**의존성**: Phase A + Phase B (B 없으면 single-user mode로 작동).

**완료 조건**:
- 교사가 강좌에서 "협업 문서" 탭 → 문서 생성
- 강좌 학생이 들어가면 자동 편집 권한
- 강좌 dropped 학생은 접근 차단

---

### Phase D — 설문지 기본 (응답 수집)

**산출물**:
- 모델 4개 (Survey, SurveyQuestion, SurveyResponse, SurveyAnswer) + alembic
- 권한 키 4개: `classroom.survey.create / edit / respond / view_results`
- `app/modules/classroom_surveys/` 모듈
- API:
  - Survey CRUD (작성자만)
  - Question 관리 (Survey 내부)
  - Response 제출 (응답자)
  - Results 조회 (작성자만 — Survey.is_anonymous 적용)
- frontend `(admin)/classroom/[cid]/surveys/page.tsx`:
  - Survey 목록 + 신규 작성
- `surveys/[sid]/page.tsx`: SurveyBuilder
  - Question type 선택 → 옵션 입력 → 미리보기
- `(student)/s/classroom/[cid]/surveys/[sid]/page.tsx`: 학생 응답 폼
  - 질문 type별 입력 UI
  - 중복 응답 방지 (allow_multiple_responses=False면)
- 응답 결과: `surveys/[sid]/results/page.tsx`
  - Question별 답 분포 (객관식·체크박스·평점은 차트, 단답형은 list)
  - CSV export 버튼

**의존성**: 독립 (Phase A/B와 무관). Phase D 단독으로 commit 가능.

**완료 조건**:
- 교사가 설문 생성 → 질문 추가 → 활성화
- 학생이 응답 (단답형, 객관식, 체크박스, 평점, 날짜 모두 작동)
- 익명/실명 옵션 동작
- 결과 페이지에서 차트 + CSV 다운로드

---

### Phase E — 단축 링크 + QR 코드

**산출물**:
- 모델 1개 (ShortLink) + alembic
- 권한 키 1개: `classroom.link.create` (admin/teacher)
- `app/modules/classroom_links/` 모듈
- API:
  - `POST /api/classroom/links` — 단축 링크 생성 (target_type + target_id)
  - `GET /api/classroom/links/{slug}/qr.png` — QR 코드 PNG (인증 필요, 작성자만)
  - `GET /api/classroom/links/{slug}/qr.svg` — SVG 버전
- frontend `app/q/[slug]/page.tsx`:
  - 익명 OK (slug → target lookup)
  - Survey/Document로 redirect (권한은 target 내부에서 가드)
- 설문 페이지 우상단 "공유" 버튼 → 모달:
  - 단축 URL (`{도메인}/q/abc123`) + 복사 버튼
  - QR 코드 미리보기 + PNG 다운로드 버튼

**Python 패키지 추가**:
```bash
pip install qrcode[pil]
```

**의존성**: Phase D 완료 후 (Survey가 일차 target).

**완료 조건**:
- 설문 만들고 "공유" → 단축 링크 + QR 표시
- QR 스캔하면 모바일에서 응답 폼 열림 (학생 로그인 후)
- 단축 링크가 학교 외부에 노출되어도, 응답 권한이 없는 외부인은 access 차단

**보안 critical**:
- 단축 링크 slug 자체는 공개 OK (의도된 동작 — QR로 배포)
- 단 그 link로 가서 응답하려면 인증 + access_mode 가드 통과 必
- `link_public` mode 설문은 익명 응답 허용 (학교 LAN 내 한정 같은 시나리오)

---

### Phase F — 폴리시 + 안전망

**산출물**:
- 학기 보관 정책: 강좌 inactive → 문서·설문 read-only
- 응답 수정 정책: 제출 후 N분 내만 수정 가능
- 운영 문서:
  - `docs/CLASSROOM_TOOLS_OPS.md` — Hocuspocus 시작·재시작·로그·문제 해결
  - SETUP.md 보강 (Node 16+ 설치, Hocuspocus 서비스 등록)
- `test_convention_invariants.py` 확장:
  - `Document.yjs_state` 같은 새 컬럼은 backup_test로 자동 검증
  - 새 권한 키 자동 부여 (default_roles)
- frontend `Bot.tsx` 같은 새 컴포넌트가 visibility 가드 적용 검증

**의존성**: A~E 다 완료 후 정리 단계.

---

## 5. 권한 매트릭스 (요약)

| 키 | 카테고리 | 부여 default |
|---|---|---|
| `classroom.doc.create` | 수업 | teacher (prefix) |
| `classroom.doc.edit` | 수업 | teacher |
| `classroom.doc.view` | 수업 | teacher, student |
| `classroom.doc.share` | 수업 | teacher |
| `classroom.survey.create` | 수업 | teacher |
| `classroom.survey.edit` | 수업 | teacher |
| `classroom.survey.respond` | 수업 | teacher, student |
| `classroom.survey.view_results` | 수업 | teacher (작성자만 추가 가드) |
| `classroom.link.create` | 수업 | teacher |

`grant_default_roles.py`의 `TEACHER_EXCLUDE_PREFIXES`에 `classroom.` 없으므로 자동 부여됨.
학생 `STUDENT_KEYS`에 `classroom.doc.view`, `classroom.survey.respond` 명시 추가.

---

## 6. 보안 체크리스트 (각 단계 적용)

- [ ] 새 모델 → `app/models/__init__.py` import 등록 (백업 자동 포함)
- [ ] 새 storage 경로 → `app/modules/files/router.py:_GUARDS`에 가드 등록 (Document에 파일 첨부 시 `classroom_docs` 추가)
- [ ] 새 권한 키 → 모듈 `permissions.py` + `require_permission` 호출
- [ ] frontend 파일 다운로드 → `downloadSecure()` 헬퍼만
- [ ] `assert_can_view_student` 호출 (학생 응답 조회 시)
- [ ] `validate_upload(file, POLICY_X)` (Document에 이미지 첨부 시)
- [ ] alembic revision 생성 + dev DB upgrade 확인
- [ ] pytest convention invariants 통과
- [ ] CI fail 0 확인

---

## 7. 운영 — Hocuspocus 서버

### 개발 환경 (사용자 본인 노트북)

```bash
# 첫 1회
cd backend-hocuspocus
npm install
npm run dev   # tsx 또는 ts-node-dev로 자동 reload

# Hocuspocus는 포트 1234에서 실행됨
```

### 학교 운영 환경

**옵션 1: systemd (Linux)**
```ini
# /etc/systemd/system/hocuspocus.service
[Unit]
Description=Hocuspocus collaboration server
After=network.target

[Service]
Type=simple
User=schooladmin
WorkingDirectory=/opt/general_school/backend-hocuspocus
ExecStart=/usr/bin/node dist/server.js
Restart=always
Environment=PORT=1234
Environment=JWT_SECRET=...  # backend와 동일
Environment=FASTAPI_URL=http://localhost:8002

[Install]
WantedBy=multi-user.target
```

**옵션 2: PM2 (Windows·Linux 공통)**
```bash
npm install -g pm2
pm2 start dist/server.js --name hocuspocus
pm2 startup  # 부팅 시 자동 시작
pm2 save
```

**옵션 3: Docker (가장 권장)**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
EXPOSE 1234
CMD ["node", "dist/server.js"]
```

### 인증 — JWT 공유

Hocuspocus 서버는 우리 FastAPI와 같은 `JWT_SECRET`을 환경변수로 받음.
클라이언트가 WS 연결할 때 query param 또는 first message로 token 전달 → 서버가 검증 → 권한 OK면 doc 접근 허용.

```ts
// frontend
const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: `doc-${docId}`,
  token: localStorage.getItem('access_token'),
});

// backend-hocuspocus
import { Server } from '@hocuspocus/server';
import jwt from 'jsonwebtoken';

const server = Server.configure({
  port: 1234,
  async onAuthenticate({ token, documentName }) {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // FastAPI에 권한 조회: GET /api/classroom/docs/{docId}/permission
    const docId = documentName.replace('doc-', '');
    const res = await axios.get(
      `${process.env.FASTAPI_URL}/api/classroom/docs/${docId}/permission`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.data.can_read) throw new Error('Forbidden');
    return { user: decoded, canWrite: res.data.can_write };
  },
});
```

### Storage — Yjs state 주기 저장

Hocuspocus `onChange` hook으로 변경 누적 → 1분 debounce 후 FastAPI에 POST:
```ts
async onChange({ documentName, document }) {
  const docId = documentName.replace('doc-', '');
  const state = Y.encodeStateAsUpdate(document);  // Uint8Array
  await axios.post(
    `${process.env.FASTAPI_URL}/api/classroom/docs/${docId}/yjs-snapshot`,
    { state_base64: Buffer.from(state).toString('base64') },
    { headers: { 'X-Internal-Token': process.env.INTERNAL_TOKEN } },
  );
}
```

FastAPI는 `X-Internal-Token` 검증해서 Hocuspocus만 호출 가능하게.

---

## 8. 학교 환경 고려사항

### 부하 산정 — 학교 규모별

**소규모 (학생 100, 교사 10)**:

| 항목 | 부담 |
|---|---|
| Hocuspocus Node 프로세스 | RAM 80~150MB |
| 활성 협업 문서 100개 in-memory | RAM +5MB (20KB/doc) |
| WebSocket 80명 keep-alive | CPU <0.5%, 네트워크 80KB/s |
| 설문 동시 80건 응답 | DB write 1초 미만 |
| **합계 추가** | **RAM ~150MB, CPU 1%** |

**중규모 (학생 500, 교사 30)**:
- 동시 협업 50~80명, RAM +30MB, CPU 2~3%
- mac mini 16GB 충분

**대규모 (학생 1500, 교사 60)**:
- 동시 협업 100~200명 (조별 활동), RAM +100MB, CPU 5~10%
- mini PC 16GB 여전히 OK

**현재 시스템 비교**:
- FastAPI uvicorn: ~80MB
- Next.js: ~300MB
- PostgreSQL: ~150MB
- + Hocuspocus 100MB → 총 700MB. 학교 PC 8GB+면 여유.

### 성능 외 부담 (운영 복잡도)

| 항목 | 영향 |
|---|---|
| Node 16+ 설치 | 학교 환경 설치 1단계 추가 |
| 프로세스 2개 관리 | systemd/PM2/Docker 선택 |
| 재시작 시 in-memory 손실 | DB snapshot에서 복원 (1분 stale OK) |
| 백업 크기 증가 | LargeBinary 100MB/100docs |
| 모니터링 포인트 | FastAPI + Hocuspocus 둘 다 watchdog |

→ **성능 문제 X, 운영 복잡도가 약간 ↑.** SETUP.md 보강으로 흡수.

### 기타

- **백업**: Yjs state는 LargeBinary 컬럼 → `Base.metadata.sorted_tables`로 자동 export.
- **장비 이관**: backup 복원 후 Hocuspocus 재시작 시 in-memory 비우고 DB snapshot에서 다시 로드.
- **외부 노출 차단**: 학교 LAN 내부만, nginx/Caddy로 외부 WebSocket 차단.

---

## 9. 우선순위 (새 세션 시작 시) — 결정 반영

**사용자 결정 (2026-05-19)**: "할 거면 B(Hocuspocus 실시간 협업)를 해야 한다."
→ single-user fallback은 의미 없음. **Phase B를 처음부터 통합**.

### 새 권장 순서

1. **Phase A+B 통합** — Document 모델 + Yjs + Hocuspocus 처음부터
   - Yjs 통합을 첫 단계로 (single-user → 협업 migration 부담 회피)
   - 가장 큰 단계지만 한 번에 끝내는 게 효율적
   - 산출물:
     · Document 모델 (yjs_state LargeBinary 포함)
     · backend-hocuspocus Node 프로젝트 (server.ts + auth.ts + storage.ts)
     · frontend CollabEditor.tsx (TipTap + Yjs + HocuspocusProvider)
     · backend snapshot endpoint
     · SETUP.md 보강 (Node 설치 + Hocuspocus 시작)
   - 완료 조건: 두 브라우저 탭 동시 편집 → 충돌 없이 sync + 사용자 커서 보임

2. **Phase D** — 설문지 (독립적, A+B 무관하게 가능)
3. **Phase E** — 단축 링크 + QR (D 활용)
4. **Phase C** — 강좌 통합 (UI 정리)
5. **Phase F** — 안전망 정리 + 운영 문서 보강

### 작업 분할 팁

Phase A+B는 큰 단계라 sub-commit으로 나눠 진행:
- A+B-1: Document 모델 + alembic + 권한 등록 + 빈 페이지
- A+B-2: backend-hocuspocus 프로젝트 생성 + auth + 기본 server
- A+B-3: backend snapshot endpoint + 권한 가드
- A+B-4: frontend CollabEditor 통합 + presence
- A+B-5: 학교 운영 절차 문서화 (SETUP.md, systemd unit)

각 sub-commit은 독립적으로 작동 검증 가능.

---

## 10. 트러블슈팅 예상

### Yjs state 충돌

여러 클라이언트의 update가 누락되면 문서 분기. 해결:
- Hocuspocus는 자동으로 모든 update를 merge (CRDT 특성)
- 단 backend snapshot 저장 시 in-flight update 손실 가능 → snapshot은 최종 결정권 X (Hocuspocus가 진실의 원천)

### Hocuspocus 죽었을 때

- 클라이언트는 자동 재연결 시도 (y-websocket provider 기본)
- 그 사이 편집 내용은 클라이언트 in-memory에 누적 → 재연결 시 sync
- 죽은 동안 새로 들어온 사용자는 마지막 DB snapshot 보임 (약간 stale)

### 학교 내부망 → 외부 접근 차단

설문 단축 링크가 학교 외부에 노출되어도:
- `link_public` 모드가 아니면 access_mode 가드로 차단
- `link_public` 모드면 익명 응답 허용되지만 권한 없는 데이터엔 접근 X

---

## 11. 새 세션 시작 시 첫 액션

1. `git pull` (이 문서 + CLAUDE.md 최신 확인)
2. backend 부팅 확인: `python -m pytest tests/ -q` → 121+ 통과
3. 본 문서 § 9의 **Phase A+B 통합**부터 시작 (사용자 결정 반영)
4. sub-commit 단위 (A+B-1 → A+B-2 → ...)로 진행, 각 단계 작동 확인 후 push
5. 의문점 있으면 사용자(신병철)에게 확인 후 진행

---

## 12. 참고

- Yjs: <https://docs.yjs.dev/>
- TipTap collaboration: <https://tiptap.dev/docs/editor/extensions/functionality/collaboration>
- Hocuspocus: <https://tiptap.dev/docs/hocuspocus/getting-started>
- qrcode (Python): <https://github.com/lincolnloop/python-qrcode>

---

**작성 후 수정 금지** — 진행 중 변경사항은 이 문서 끝에 `## 추가 결정 (날짜)` 섹션으로 누적.

---

## 추가 결정 (2026-05-19)

### Phase A·B를 합쳐서 통합 진행

- 이전 권장: Phase A (single-user) → 나중에 B (Yjs 통합)
- 변경: **A+B 한 번에**. single-user 단계 skip.
- 이유: 사용자(신병철) "할 거면 B하는게 맞음" — Google Docs 식 동시 편집이 목표
- 트레이드오프: 첫 commit이 더 크지만, single→collab migration 부담 회피 + 운영 단순화

### 부하 산정 추가 (§8)

- 학교 규모별 RAM/CPU 추정치 명시
- 진짜 부담은 운영 복잡도 (Node 프로세스 1개 + systemd 관리)
- 학교 PC 16GB면 충분히 감당

---

## 진행 상황 (2026-05-19)

### Phase A+B (협업 문서) — 완료 ✅

5개 sub-commit으로 분할 진행. main 직접 push.

**A+B-1: 모델·라우터·권한 + 빈 페이지** (commit 75cb6b3)
- `app/models/classroom_docs.py` : ClassroomDocument / DocumentMember / DocumentRevision (yjs_state LargeBinary)
- `app/modules/classroom_docs/` : CRUD + 멤버 + permission/snapshot endpoint
- 권한 4개 (`classroom.doc.{create,edit,view,share}`) 시드 + role auto-grant
- alembic migration `4f4e265df128`
- frontend `/classroom/[cid]/docs(/[did])` + `/s/classroom/[cid]/docs(/[did])` (placeholder)
- 강좌 상세에 "협업 문서" 진입 버튼 (admin·student)
- 검증: 보안+convention invariant 42/42 통과

**A+B-2: Hocuspocus Node.js 사이드카** (commit e48c0f2)
- `backend-hocuspocus/` Node TypeScript 프로젝트 (포트 1234)
- `src/server.ts` — onAuthenticate / onLoadDocument / onChange (debounce) / onDisconnect
- `src/auth.ts` — JWT HS256 검증 + FastAPI permission API 호출
- `src/storage.ts` — Yjs state load/store (base64), plain_text 추출
- `src/config.ts` — env 기반 (PORT/JWT_SECRET/FASTAPI_URL/INTERNAL_TOKEN/debounce_ms)
- 검증: npm install + tsc + 부팅 확인

**A+B-3: read-only 강제 + 보안 테스트** (commit 4e0416c)
- Hocuspocus: `connection.readOnly = true` (can_write=false 사용자) → 변경 message 자동 거부
- backend: `HOCUSPOCUS_INTERNAL_TOKEN`을 settings에 명시 (pydantic-settings extra_forbidden 회피)
- `tests/test_classroom_docs.py` (security mark) 11건:
  · snapshot POST 토큰 가드 (401/503/200 + revision 저장)
  · 강좌 비멤버 GET 403, 멤버 read+write OK, owner full
  · archived → can_write=false 강제 (permission endpoint)
  · 학생 doc.create / doc.share 권한 없음 시 403
- 검증: security 마킹 101/101 통과 (이전 90 + 신규 11)

**A+B-4: CollabEditor (TipTap + Yjs)** (commit 28e667d)
- `components/docs/CollabEditor.tsx` — TipTap + Collaboration + CollaborationCaret + HocuspocusProvider
  · StarterKit `undoRedo: false` (Yjs collaboration이 자체 제공)
  · localStorage access_token 전달, onAuthenticationFailed 알림
  · 상태 배지 (Wifi/WifiOff/Loader2), 툴바 (Bold/Italic/H/List/Quote/Undo/Redo)
  · 사용자 ID 기반 HSL 커서 색상 (presence)
- admin/student docs/[did]/page.tsx: placeholder → CollabEditor
  · `canWrite = doc.permission.can_write && !doc.is_archived`
- deps: @tiptap/{react,starter-kit,extension-placeholder,extension-collaboration,extension-collaboration-caret}, @hocuspocus/provider, yjs
- TipTap v3은 `extension-collaboration-caret` (v2 cursor에서 이름 변경)
- 검증: npx tsc --noEmit 통과

**A+B-5: SETUP.md 보강 + 운영 문서** (이 commit)
- SETUP.md § 3 (env) : HOCUSPOCUS_INTERNAL_TOKEN 생성 명령 추가
- SETUP.md § 5.5 : 협업 문서 서버 셋업 절차 신설
- SETUP.md § 6 : 터미널 ③ (hocuspocus dev) 추가
- SETUP.md § 10.3.5 : production systemd `school-hocuspocus.service`
- SETUP.md § 10.4 : Caddyfile `/yjs/*` reverse-proxy 추가
- SETUP.md § 10.8 : 운영 점검 체크리스트에 school-hocuspocus 추가
- .env.example : HOCUSPOCUS_INTERNAL_TOKEN + NEXT_PUBLIC_HOCUSPOCUS_URL 가이드
- backend-hocuspocus/README.md (이미 A+B-2에서 작성)

### 검증 결과
- backend lifespan (PERM 검증) 통과
- alembic upgrade head 성공
- pytest security 101/101 통과
- npx tsc --noEmit (frontend) 통과
- Hocuspocus 부팅 OK + WS listen

### Phase D (설문지) — 완료 ✅

**D-1 backend** (0b3548d)
- 모델 4개 (Survey/Question/Response/Answer) + alembic c7d1710fc06d
- 모듈 `classroom_surveys`: CRUD + 질문 관리 + 응답 + 결과 집계 + CSV
- 권한 4개 (survey.{create,edit,respond,view_results}). 학생/직원은 respond만.
- 정책: draft에서만 질문 변경. 익명 모드는 respondent_id=null 저장.
- 보안 테스트 10건 — security 111/111 통과

**D-2 frontend** (6728177)
- admin 목록 + 새 설문 모달
- SurveyBuilder: 제목 인라인 편집, 상태 토글, 질문 추가 모달 (6 type), 미리보기
- 학생 목록 (draft 숨김) + 응답 폼 (type별 컨트롤, 필수 검증)
- 강좌 상세에 "설문지" 진입 버튼

**D-3 frontend** (32c7a75)
- 결과 페이지: ChoiceBars / RatingDistribution / TextAnswerList
- CSV 다운로드 (fetch + blob)
- 차트 라이브러리 없이 div + width % 로 horizontal bar

### Phase E (단축 링크 + QR) — 완료 ✅

**E-1 backend** (0649405)
- 모델 ShortLink (slug base62 6~16자, target_type/id, expires_at, click_count)
- 모듈 `classroom_links`:
  - POST /api/classroom/links (멱등 — 같은 target 본인 링크 재사용)
  - GET  /api/classroom/links/by-target
  - GET  /api/classroom/links/{slug}/qr.{png,svg} — qrcode + PIL/Svg factory
  - GET  /q/{slug}/resolve — 익명 OK, click_count 증가, 만료 시 410
- 권한 `classroom.link.create` — teacher 기본
- alembic e58ebf1bfb9f
- naive↔aware datetime 안전 처리 (SQLite vs PG)
- 테스트 9건 — security 120/120 통과

**E-2 frontend** (이 commit)
- `/q/[slug]` 페이지 — resolve → 사용자 role에 따라 redirect
  - 미로그인: `/auth/login?next=...`
  - survey → /classroom/{cid}/surveys/{sid} (teacher) 또는 /s/... (student)
  - document → /classroom/{cid}/docs/{did}
- `components/classroom/ShareLinkModal.tsx`:
  - POST /links (멱등) → short_url + 복사 (clipboard + execCommand fallback)
  - QR PNG fetch + blob → <img> 미리보기 + 다운로드
- SurveyBuilder active 상태에 "공유" 버튼 + 모달
- 협업 문서 편집기 (작성자/admin) 에도 "공유" 버튼 추가

### 모듈화 + Phase C·F 마무리 (이 commit)

**Backend 분할** (이전 세션 sub-router 패턴 적용):
- `classroom_surveys/router.py` 645줄 → router 24 + _helpers 90 + crud 145 + questions 80 + responses 90 + results 175
- `classroom_docs/router.py` 464줄 → router 20 + _helpers 95 + crud 145 + members 95 + hocuspocus 100
- 각 sub-module은 router.py의 `router`를 import해 endpoint 등록 (portfolio 모듈 패턴 동일)

**Phase F: 학기 보관 정책**:
- `assert_active_course_or_403(course)` — course.is_active=false면 new doc/survey 생성 시 409
- 회귀 테스트 `tests/test_classroom_archived.py` 3건
  · archived 강좌에 새 문서 생성 → 409
  · archived 강좌에 새 설문 생성 → 409
  · active 강좌는 정상 생성 (false-positive 방지)

**Phase C-mini**:
- 강좌 상세에 "보관 강좌" 배지 + 안내 박스 (`!course.is_active` 시)

검증: pytest security 123/123 (이전 120 + archived 3), npx tsc --noEmit 통과.

### Builder 분할 + 응답 수정 정책 (이 commit)

**SurveyBuilder 분할** (frontend 200줄 기준):
- `/classroom/[cid]/surveys/[sid]/page.tsx` 469 → 263
- `_components/_types.ts` (32): QType / Question / TYPE_LABELS 공유
- `_components/QuestionPreview.tsx` (54): 유형별 응답 UI 모방
- `_components/QuestionCard.tsx` (43): 빌더 카드
- `_components/AddQuestionModal.tsx` (147): 질문 추가 모달
- Next.js `_` prefix → 라우트 노출 안 됨

**응답 수정 정책**:
- 모델: `Survey.response_edit_minutes` (기본 0=수정 불가, 0~10080=최대 1주)
- 헬퍼: `response_editable_until(survey, submitted_at)` / `can_edit_response(...)`
- 라우터: `PUT /api/classroom/surveys/responses/{rid}`
  · 본인 응답만 (`respondent_id == user.id`)
  · 익명 응답(`respondent_id=null`)은 식별 불가 → 403
  · 활성 상태 + 시한 내만. 시한 외 → 409
  · 단순 strategy: 기존 답변 모두 삭제 후 새로 생성
- API 응답: `my_response.editable_until` 노출 (frontend가 사용)
- alembic migration `dd2545140022` — server_default='0' backfill 안전 처리
- 회귀 테스트 5건 (security mark):
  · 기본(0)이면 PUT 409
  · 시한 내 PUT 200 + 답 교체 검증
  · submitted_at 백데이트로 시한 외 → 409
  · 다른 사용자 PUT → 403
  · 익명 응답 PUT → 403

**Frontend UI**:
- Admin Builder: "응답 후 수정 허용 (분)" input 추가 — 작성자만, 모든 상태에서 동적 변경 가능
- 학생 응답 화면: 이미 응답 + `editable_until > now`이면 "응답 수정" 버튼
  · 수정 모드 진입 → 같은 폼이지만 PUT 호출. 수정 중 배지 + 안내 박스.

검증:
- pytest security 128/128 통과 (123 + 응답수정 5)
- npx tsc --noEmit 통과
- backend alembic head 일치 (dd2545140022)
