# 개발 환경 설치 (복붙용)

GitHub repo를 clone해서 새 환경(Linux / WSL Ubuntu / Mac)에 처음부터 개발용 셋업하는 모든 명령어를 순서대로 적은 것. 위에서부터 차례로 복붙.

**이 문서의 대상**:
- 새 개발 PC에 dev 환경 셋업
- 본인 노트북에서 코드 만져보기
- (선택) 한 노트북에서 소규모 운영 시작 → 안정화 후 [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md)로 production 전환

**학교 방문해서 서버 셋업한다면**: 이 문서 대신 [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md)와 [DEPLOYMENT_DAY.md](./DEPLOYMENT_DAY.md)를 따라가세요. 한 줄 셋업 스크립트(`scripts/setup-production.sh`) 사용.

대상 OS: **Ubuntu 22.04 / 24.04** 또는 **WSL2 Ubuntu**. Mac도 거의 동일 (apt → brew).

---

## 0. 사전 요구사항 (한 번만)

### Ubuntu / WSL Ubuntu
```bash
# 시스템 패키지
sudo apt update
sudo apt install -y python3.12-venv python3.12-dev build-essential libpq-dev curl ca-certificates git

# Node.js 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 확인
python3 --version    # Python 3.12.x
node --version       # v22.x.x
npm --version        # 10.x+
git --version
```

### Mac
```bash
brew install python@3.12 node@22 git
brew link --overwrite node@22

python3 --version
node --version
```

---

## 1. GitHub 인증 (private repo이므로 필수)

### 옵션 A — GitHub CLI (가장 간단) ★추천
```bash
# Ubuntu
sudo apt install -y gh
gh auth login
# → GitHub.com → HTTPS → Y → "Login with a web browser"
# → 8자리 코드 복사 → 자동 열린 브라우저에 붙여넣기

gh auth status   # 확인
```

### 옵션 B — Personal Access Token (PAT)
1. https://github.com/settings/tokens → "Generate new token (classic)"
2. **Scopes**: `repo` 체크
3. 만료 30일 정도 설정 → Generate → 복사
4. 다음 명령에서 username + 토큰 입력

---

## 2. Repo Clone

```bash
cd ~
git clone https://github.com/sinbc2003/general_school.git
cd general_school
```

PAT 사용 시 username = `sinbc2003`, password = 토큰 붙여넣기.
gh CLI 사용 시 자동 인증.

비밀번호 안 묻도록 캐싱:
```bash
git config --global credential.helper store
```

---

## 3. PostgreSQL 설치 + DB 생성

본 프로젝트는 **dev/운영 모두 PostgreSQL 표준** (2026-05-14 전환됨). SQLite는 더 이상 지원하지 않습니다.

```bash
cd ~/general_school
chmod +x scripts/setup_postgres.sh
./scripts/setup_postgres.sh
```

`sudo` 비밀번호 한 번 입력. 스크립트가 자동으로:
- `apt install postgresql postgresql-contrib`
- 서비스 시작 (`sudo service postgresql start`)
- DB `general_school`, user `app` 생성 (비밀번호는 랜덤 hex)
- 연결 테스트 (`SELECT 'OK'`)

마지막에 출력되는 한 줄을 **복사해두세요**:
```
DATABASE_URL=postgresql+asyncpg://app:xxxxx@localhost:5432/general_school
```

**WSL 부팅 시 PostgreSQL 자동 시작** (선택):
```bash
echo 'sudo service postgresql start 2>/dev/null' >> ~/.bashrc
```
(sudo NOPASSWD 설정 필요. 학교 운영 노트북은 systemd로 항상 실행.)

---

## 4. 환경 변수 설정 (필수)

```bash
cp .env.example .env

# 강한 랜덤 키 3개 생성해서 .env에 채움
python3 -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('ENCRYPTION_MASTER_KEY=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('HOCUSPOCUS_INTERNAL_TOKEN=' + secrets.token_urlsafe(32))"
# 출력된 값을 .env 파일에서 해당 줄에 붙여넣기

nano .env   # 또는 vim/code
```

`.env`에서 최소 변경할 줄:
```env
# Step 3에서 출력된 DATABASE_URL
DATABASE_URL=postgresql+asyncpg://app:xxxxx@localhost:5432/general_school

# 위 명령으로 생성한 강한 랜덤 (32바이트)
JWT_SECRET=<token_urlsafe(32) 출력>
ENCRYPTION_MASTER_KEY=<token_urlsafe(32) 출력>
HOCUSPOCUS_INTERNAL_TOKEN=<token_urlsafe(32) 출력>

SCHOOL_NAME=실제 학교 이름
DEFAULT_USER_PASSWORD=강한_초기_비밀번호  # 사용자 일괄 등록 시 기본값
```

⚠️ **`ENCRYPTION_MASTER_KEY` 분실 시** LLM API 키·Google refresh_token 등 암호화 데이터 복호화 불가. **별도 안전 보관 권장** (외장 SSD 또는 비밀 관리자).

⚠️ **`.env`는 `.gitignore`에 들어 있어** GitHub에 절대 안 올라감. 각 컴퓨터마다 따로 만들어야 함.

`HOCUSPOCUS_INTERNAL_TOKEN`은 협업 문서/시트/슬라이드/설문 기능을 안 쓸 거면 비워두 OK (snapshot endpoint가 503으로 비활성). 쓰려면 다음 단계(7)에서 같은 값을 양쪽 `.env`에 동기화.

---

## 5. 백엔드 셋업

```bash
cd ~/general_school/backend

# Python 가상환경
python3 -m venv venv
source venv/bin/activate

# 의존성 설치 (3~5분)
pip install --upgrade pip
pip install -r requirements.txt

# DB 스키마 생성
alembic upgrade head
```

---

## 6. 프론트엔드 셋업

```bash
cd ~/general_school/frontend
npm install        # 1~2분, ~550MB
```

---

## 7. 협업 문서 서버 셋업 (Hocuspocus, 선택)

**클래스룸 → 협업 문서/시트/슬라이드/설문**(Yjs 실시간 동시 편집)을 사용하려면 backend·frontend 외에 Hocuspocus 사이드카(WebSocket 서버, 포트 1234)도 띄워야 합니다.

```bash
cd ~/general_school/backend-hocuspocus
npm install        # 30초~1분
cp .env.example .env
nano .env
```

`backend-hocuspocus/.env`:
```env
PORT=1234
JWT_SECRET=<루트 .env의 JWT_SECRET과 동일>
JWT_ALGORITHM=HS256
FASTAPI_URL=http://localhost:8002
HOCUSPOCUS_INTERNAL_TOKEN=<루트 .env의 HOCUSPOCUS_INTERNAL_TOKEN과 동일>
SNAPSHOT_DEBOUNCE_MS=60000
ENV=dev
```

⚠️ **일치 검증**: 루트 `.env`와 `backend-hocuspocus/.env`의 `JWT_SECRET` + `HOCUSPOCUS_INTERNAL_TOKEN`이 글자 단위로 똑같아야 합니다. 다르면 협업 도구가 "연결 끊김" 표시.

---

## 8. 실행 — "서버키" 시 3개 모두 띄울 것

**개발 시 3개 서버를 모두 띄워야** 합니다 (협업 도구가 Hocuspocus 의존).
사용자가 "서버키" 또는 "서버 켜"라고 말하면 아래 3개 모두 실행 의미.

`tmux`/`screen` 권장. Windows는 `start-backend.bat` / `start-frontend.bat` / `start-hocuspocus.bat`.

### 터미널 ① — 백엔드 (포트 8002)
```bash
cd ~/general_school/backend
source venv/bin/activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```
"Application startup complete" 보이면 OK.

### 터미널 ② — 프론트엔드 (포트 3000)
```bash
cd ~/general_school/frontend
npm run dev
```
"Ready" 보이면 OK.

### 터미널 ③ — Hocuspocus (포트 1234, 협업 도구 쓸 때)
```bash
cd ~/general_school/backend-hocuspocus
npm run dev
```
성공 시:
```
Hocuspocus v2.x running at:
  > WebSocket: ws://0.0.0.0:1234
[hocuspocus] 협업 문서 서버 시작 — port 1234
```

브라우저: **http://localhost:3000**

---

## 9. 첫 사용 — 최고관리자 가입 + 온보딩 마법사

### 9.1 첫 가입 = super_admin 자동
DB가 비어있으므로 자동으로 첫 가입 모드:

1. http://localhost:3000/auth/login 접속
2. 페이지 하단 **"첫 가입자(최고관리자) 등록하기 →"** 링크 클릭
3. 이름·이메일·아이디·비밀번호(8자+) 입력
4. 가입 → super_admin 자동 부여 + 자동 로그인 + **🧙 온보딩 마법사 자동 시작**

### 9.2 온보딩 마법사 (8단계)

마법사가 자동으로 안내:
1. 환영
2. **부서** — 교무부·학생부·연구부·진로상담부·교육과정부·정보부·방과후부 7개 표준 일괄 등록
3. **학기** — 현재 학기 활성화
4. **교사 CSV 일괄 등록** (양식: `department, name, phone`)
5. **학생 CSV 일괄 등록** (양식: `student_no, name, phone` — 학번 `1-3-5` 또는 `10305` 자동 parse)
6. **담임 배정**
7. **강좌 자동 생성** (학년부·학급·교과별)
8. 완료

이때 자동 폴더(부서/학년부/담임/수업/수강) 생성됨 → 사용자 드라이브에 즉시 보임.

대시보드 우상단 🧙 버튼으로 언제든 재시작 가능 (`/system/onboarding`).

### 9.3 기본 권한 자동 부여

backend 부팅 시 `scripts/grant_default_roles.py`가 자동 실행되어 teacher/staff/student에게 기본 권한이 자동 부여됩니다 (멱등). 수동 실행 불필요.

새 권한 키 추가 후 적용하려면 backend 재시작:
```bash
sudo systemctl restart gs-backend   # production
# 또는 dev에서 uvicorn 재시작
```

### 9.4 정책 토글 (선택)

**시스템 → 설정 → 교사 학생 열람 범위**:
- "모든 학생 열람" (기본)
- "담당 학생만" — 본인 담임/부담임 학급 + 본인 수업 학년·학급 학생만

---

## 10. AI 챗봇 활성화 (관리자 작업, 선택)

`/system/llm/providers`:

1. Anthropic / OpenAI / Google 중 하나 이상에 API 키 입력
2. "연결 테스트" → 성공 확인 → "활성화" 토글
3. `/system/llm/config`: 교사·학생 기본 모델 선택
4. 사용자가 **AI 챗봇** 메뉴 → 새 탭에서 claude.ai 풍 인터페이스

학생 비용 통제: `student_can_change_model=false` 유지 + 저렴한 모델 강제 (Haiku, Gemini Flash, gpt-4o-mini).
`/system/llm/usage`에서 일별/모델별/사용자별 비용 집계.

---

## 11. Google Drive 연동 (선택)

`/system/integrations/google` → 마법사 따라:
1. Google Cloud Console에서 OAuth Client 생성
2. Authorized redirect URI: `http://localhost:8002/api/google/callback` (production은 학교 도메인)
3. Client ID/Secret 입력 → 사용자가 본인 계정에서 "Google 계정 연결"
4. 본인 Drive 파일 그리드 + 문서/시트 export 가능

상세: `/system/integrations/google` 페이지 안내.

---

## 12. 일상 작업

### 코드 수정 후 GitHub에 push
```bash
cd ~/general_school
git add .
git commit -m "변경 내용"
git push origin main
```

### 변경사항 받기 (학교 노트북 업그레이드 등)
```bash
cd ~/general_school
git pull

# 의존성 변경분 적용
cd backend && source venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install
cd ../backend-hocuspocus && npm install  # (협업 도구 쓸 때)

# DB 스키마 변경 적용
cd ../backend && alembic upgrade head

# 서비스 재시작 (production)
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

### dev 캐시 깨졌을 때
`Cannot read properties of null (reading 'useContext')` 등 SSR 에러가 hot reload 후 발생하면:

```bash
# 1) frontend dev 종료
wsl -d Ubuntu bash -c "pkill -f 'next dev'"

# 2) .next 캐시 삭제
rm -rf ~/general_school/frontend/.next

# 3) 재시작
cd ~/general_school/frontend && npm run dev
```

---

## 13. 백업 / 복원

운영 환경 백업은 [production/README.md](./production/README.md)와 [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md) 참조.

**dev 환경 수동 백업**:
```bash
mkdir -p ~/backup

# PostgreSQL dump
pg_dump -F c general_school > ~/backup/db_$(date +%F).dump

# 사용자 업로드
tar czf ~/backup/storage_$(date +%F).tar.gz ~/general_school/backend/storage/

# .env (분실 시 암호화 데이터 복호화 불가)
cp ~/general_school/.env ~/backup/env_$(date +%F).backup
```

**복원**:
```bash
# 1. 서비스 중지
sudo systemctl stop gs-backend gs-frontend gs-hocuspocus

# 2. DB 복원
pg_restore -d general_school ~/backup/db_2026-05-21.dump

# 3. storage 복원
tar xzf ~/backup/storage_2026-05-21.tar.gz -C ~/general_school/backend/

# 4. 서비스 재시작
sudo systemctl start gs-backend gs-frontend gs-hocuspocus
```

**웹 UI 백업** (수동·학교 이관용): `/system/backup` 페이지에서 ZIP 다운로드 → 외장 SSD 보관.
새 장비로 이관 시 새 장비의 같은 페이지에서 업로드 → 자동 복원.

**개인 드라이브 백업** (학교 이동 시):
- `/drive` 또는 `/s/drive` 우상단 "백업 ZIP" → 본인 자료 ZIP 다운로드
- 다른 학교/시스템에서 "복원" → 본인 자료 + 폴더 구조 자동 복원
- ZIP 안에 사람-읽기 형식(HTML/XLSX/CSV/HWPX) 포함 → 시스템 import 없이도 자료 열기 가능
- (선택) "Google 백업" → 본인 Google 계정에 문서·시트 일괄 export

---

## 14. 트러블슈팅

### "Address already in use" (포트 충돌)
```bash
sudo lsof -i :8002    # 또는 :3000, :1234
kill -9 <PID>
```

### "Module not found" (backend)
가상환경 활성화 확인: `which python` → `.../venv/bin/python`

### "next/package.json invalid"
node_modules 깨짐 — 재설치:
```bash
cd frontend
rm -rf node_modules package-lock.json .next
npm install
```

### PostgreSQL 연결 실패
- `sudo service postgresql start` 또는 `sudo systemctl status postgresql`
- 비밀번호 특수문자 있으면 .env에서 URL encoding 필요 (예: `@` → `%40`)
- `.env`의 `DATABASE_URL` 재확인

### 협업 도구 "연결 끊김"
- 터미널 ③ Hocuspocus 떠 있는지 확인
- 루트 `.env`와 `backend-hocuspocus/.env`의 `JWT_SECRET` + `HOCUSPOCUS_INTERNAL_TOKEN` 일치 확인

### `.env` 변경 반영 안 됨
백엔드 재시작 필요 (uvicorn `--reload` 켜져 있어도 환경변수는 시작 시점만 읽음).

### Alembic upgrade 실패
- `.env`의 `DATABASE_URL` 확인
- 처음 PostgreSQL 전환 시 `alembic stamp head` 한 번 시도

### 한글 콘솔 깨짐 (Windows PowerShell)
```powershell
chcp 65001    # UTF-8 모드
```
또는 그냥 WSL 사용.

---

## 15. 자주 쓰는 한 줄 명령

```bash
# 모든 서비스 동시 실행 (tmux, dev)
tmux new -s gs-backend -d "cd ~/general_school/backend && source venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload"
tmux new -s gs-frontend -d "cd ~/general_school/frontend && npm run dev"
tmux new -s gs-hocuspocus -d "cd ~/general_school/backend-hocuspocus && npm run dev"

# 종료
tmux kill-session -t gs-backend
tmux kill-session -t gs-frontend
tmux kill-session -t gs-hocuspocus

# 로그 보기
tmux attach -t gs-backend       # 빠져나오기: Ctrl+B 다음 D
```

---

## 16. 다음 단계

- 소규모 운영을 그대로 dev 모드(uvicorn `--reload`)로 시작해도 OK — 80명 동접까지
- 정식 학교 운영(1300+명)은 **`scripts/setup-production.sh`** 한 줄로 production 전환 권장
  → [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md) 따라가기
- 운영 중 명령 reference: [production/README.md](./production/README.md)
