# 다른 컴퓨터에 옮기는 방법 (복붙용 가이드)

이 문서는 GitHub repo를 clone해서 새 환경(Linux / WSL Ubuntu / Mac)에 처음부터 셋업하는 모든 명령어를 순서대로 적은 것이다. 위에서부터 차례로 복붙.

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
# Homebrew 필요
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

# 확인
gh auth status
```

### 옵션 B — Personal Access Token (PAT)
1. https://github.com/settings/tokens → "Generate new token (classic)"
2. **Scopes**: `repo` 체크
3. 만료 30일 정도 설정 → Generate → 복사
4. 다음 명령에서 username + 토큰 입력

---

## 2. Repo Clone

```bash
# 홈 디렉토리에 clone
cd ~
git clone https://github.com/sinbc2003/general_school.git
cd general_school
```

PAT 사용 시 username = `sinbc2003`, password = 토큰 붙여넣기.  
gh CLI 사용 시 자동 인증.

다음 push/pull부터 비밀번호 안 묻도록 캐싱:
```bash
git config --global credential.helper store
```

---

## 3. 환경 변수 설정 (필수)

```bash
cp .env.example .env

# 강한 랜덤 키 2개 생성해서 .env에 채움
python3 -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('ENCRYPTION_MASTER_KEY=' + secrets.token_urlsafe(32))"
# 출력된 값을 .env 파일에서 해당 줄에 붙여넣기

nano .env   # 또는 vim/code
```

`.env`에서 최소 변경할 줄:
```env
JWT_SECRET=<위 명령으로 생성한 32바이트 랜덤>
ENCRYPTION_MASTER_KEY=<위 명령으로 생성한 32바이트 랜덤>
SCHOOL_NAME=실제 학교 이름
DEFAULT_USER_PASSWORD=강한_초기_비밀번호  # 사용자 일괄 등록 시 기본값
```

**주의**: `.env`는 `.gitignore`에 들어 있어 GitHub에 절대 안 올라감. 각 컴퓨터마다 따로 만들어야 함.

---

## 4. 백엔드 셋업

```bash
cd ~/general_school/backend

# Python 가상환경
python3 -m venv venv
source venv/bin/activate

# 의존성 설치 (3~5분)
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 5. 프론트엔드 셋업

```bash
cd ~/general_school/frontend

npm install        # 1~2분, ~550MB
```

---

## 6. 실행 (개발 모드)

**터미널 2개 필요** (또는 `tmux`/`screen`).

### 터미널 ① — 백엔드 (포트 8002)
```bash
cd ~/general_school/backend
source venv/bin/activate
DATABASE_URL='sqlite+aiosqlite:///general_school.db' \
PYTHONIOENCODING=utf-8 \
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002
```

### 터미널 ② — 프론트엔드 (포트 3000)
```bash
cd ~/general_school/frontend
npm run dev
```

브라우저: **http://localhost:3000**

---

## 7. 첫 사용 — 최고관리자 가입 + 초기 설정

### 7.1 첫 가입 (super_admin)
DB가 비어있으므로 자동으로 첫 가입 모드:

1. http://localhost:3000/auth/login 접속
2. 페이지 하단에 **"첫 가입자(최고관리자) 등록하기 →"** 링크 보임
3. 클릭 → 이름·이메일·아이디·비밀번호(8자+) 입력
4. 가입 → super_admin 자동 부여 + 자동 로그인

### 7.2 기본 권한 매트릭스 부여 (Critical, 1회만)

가입 직후 super_admin만 메뉴를 볼 수 있습니다. teacher/staff/student에게 합리적 기본 권한을 일괄 부여하려면:

```bash
cd ~/general_school/backend
source venv/bin/activate
python -m scripts.grant_default_roles
```

출력:
```
전체 권한: 101개
+ teacher 권한 추가: 82
+ staff 권한 추가: 8
+ student 권한 추가: 23
```

이후 super_admin이 `/permissions` 페이지에서 개별 조정 가능.

### 7.3 학기 시스템 초기 설정

학기는 시드 시 자동 생성됩니다 (예: 2026학년도 1학기). 명단·구조 설정:

1. **시스템 → 학기 관리** → 🏫 아이콘 클릭 → **학교 구조 설정**:
   - 학년별 학급 수 (예: 1학년 5반, 2학년 5반, 3학년 4반)
   - 개설 과목 (Enter로 칩 추가, 예: 수학·수학I·물리)
   - 부서 목록 (예: 수학과·과학과·행정실)

2. **시스템 → 학기별 명단** → **CSV 일괄 등록**:
   - **교직원** CSV: `department, name, phone` (최소 양식)
     - 이름이 자동 아이디로 부여 (동명이인은 `홍길동_2` 자동)
     - 핸드폰 숫자가 초기 비밀번호
   - **학생** CSV: `student_no, name, phone`
     - 학번은 `1-3-5` 또는 `10305` 형식 자동 parse → 학년/반/번호로 분리

3. **교사 첫 로그인**: 자동으로 `/auth/teacher-onboarding` 페이지로 강제 이동
   - 드롭다운으로 본인 담임 학급 / 부담임 학급 / 수업 학년 / 가르치는 과목 선택
   - 저장 → 일반 사용 가능

### 7.4 정책 토글 (선택)

**시스템 → 설정 → 교사 학생 열람 범위**:
- "모든 학생 열람" (기본)
- "담당 학생만" — 본인 담임/부담임 학급 + 본인 수업 학년·학급 학생만 보임

### 7.5 기타 사용자 일괄 등록 (옵션)

`/users` 페이지의 **"CSV 일괄 등록"** 버튼 — 옛 양식 (학기 시스템 무관):
- 역할 선택 (지정관리자 / 교사 / 학생)
- 템플릿 다운로드 (예시 1행 포함, UTF-8 BOM)
- 채워서 업로드 → dry-run 검증 → 실행

**권장**: 학기별 명단 CSV (7.3) 사용. 학기 격리·진급/전출·교사 onboarding과 자동 연동됨.

---

## 8. AI 챗봇 활성화 (관리자 작업)

가입 후 좌측 메뉴 **AI 설정 → Provider/API 키**:

1. Anthropic / OpenAI / Google 중 하나 이상에 API 키 입력
2. "연결 테스트" → 성공 확인 → "활성화" 토글
3. **AI 설정 → 기본 설정**: 교사·학생 기본 모델 선택
4. 사용자가 **AI 챗봇** 메뉴 클릭 → 새 탭에서 claude.ai 풍 인터페이스

학생 비용 통제: `student_can_change_model = false` 유지 + 저렴한 모델 강제 (Haiku, Gemini Flash, gpt-4o-mini).

---

## 9. 일상 작업

### 코드 수정 후 GitHub에 push
```bash
cd ~/general_school
git add .
git commit -m "변경 내용"
git push
```

### 다른 곳에서 변경한 거 받기 (업그레이드)
```bash
cd ~/general_school

# 1. 코드 받기
git pull

# 2. 의존성 변경분 적용
cd backend && source venv/bin/activate && pip install -r requirements.txt
cd ../frontend && npm install

# 3. DB 스키마 변경 적용 (Alembic 마이그레이션)
cd ../backend && alembic upgrade head

# 4. 서비스 재시작 (systemd 운영 중인 경우)
sudo systemctl restart school-backend
# 또는 dev 모드면 uvicorn 종료 후 재실행

# 5. 프론트엔드 production 재빌드 (운영 중)
cd ../frontend && npm run build && sudo systemctl restart school-frontend
```

**Alembic이 처음 활성화될 때**: 기존 DB는 한 번 `alembic stamp head`로 표시 (마이그레이션 baseline 동기화). 위 명령은 dev 환경에서 한 번만.

### 백업 (운영 데이터)
```bash
mkdir -p ~/backup

# DB (가장 중요)
cp ~/general_school/backend/general_school.db ~/backup/general_school_$(date +%F).db

# 사용자 업로드 파일 (학생 산출물, 과제 제출물, 학교 로고 등)
tar czf ~/backup/storage_$(date +%F).tar.gz ~/general_school/backend/storage/

# .env (JWT_SECRET, ENCRYPTION_MASTER_KEY 분실 시 기존 데이터 복호화 불가 — 별도 안전 보관)
cp ~/general_school/.env ~/backup/env_$(date +%F).backup
```

**자동 백업 (매일 새벽 3시)**: `crontab -e`에 추가
```
0 3 * * * cp ~/general_school/backend/general_school.db ~/backup/general_school_$(date +\%F).db && find ~/backup -name 'general_school_*.db' -mtime +30 -delete
```

### 복원
```bash
# 1. 서비스 중지
sudo systemctl stop school-backend school-frontend

# 2. DB 복원
cp ~/backup/general_school_2026-05-14.db ~/general_school/backend/general_school.db

# 3. storage 복원
tar xzf ~/backup/storage_2026-05-14.tar.gz -C ~/general_school/backend/

# 4. 서비스 재시작
sudo systemctl start school-backend school-frontend
```

---

## 10. 운영 배포 (학교 단위)

`CLAUDE.md`의 "운영 / 배포" 섹션 참고. 짧게:

### 4가지 production 전환 (30분)
```bash
# 1. gunicorn + 4 worker
pip install gunicorn
gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8002

# 2. SQLite WAL 모드 (PG 전환 전 임시)
# core/database.py init_db()에:
#   await conn.exec_driver_sql("PRAGMA journal_mode=WAL;")

# 3. Frontend production 빌드
cd frontend && npm run build && npm start

# 4. systemd 서비스화 (자동 재시작)
sudo nano /etc/systemd/system/school-backend.service
# (서비스 파일 작성 — 아래 예시)
sudo systemctl enable --now school-backend
```

### systemd 서비스 예시
```ini
# /etc/systemd/system/school-backend.service
[Unit]
Description=General School Backend
After=network.target

[Service]
Type=simple
User=sinbc
WorkingDirectory=/home/sinbc/general_school/backend
Environment="DATABASE_URL=sqlite+aiosqlite:///general_school.db"
Environment="PYTHONIOENCODING=utf-8"
ExecStart=/home/sinbc/general_school/backend/venv/bin/gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker -w 4 -b 0.0.0.0:8002
Restart=always

[Install]
WantedBy=multi-user.target
```

### 교내 LAN only 강제 (방화벽)
```bash
sudo ufw allow from 192.168.0.0/16 to any port 3000
sudo ufw allow from 192.168.0.0/16 to any port 8002
sudo ufw enable
```

---

## 11. 트러블슈팅

### "Address already in use" (포트 충돌)
```bash
# 8002, 3000 사용 중인 프로세스 찾아 종료
sudo lsof -i :8002
sudo lsof -i :3000
kill -9 <PID>
```

### "Module not found" (backend)
가상환경 활성화 확인: `which python` → `.../venv/bin/python` 나와야 함

### "next/package.json invalid"
node_modules 깨짐 — 재설치:
```bash
cd frontend
rm -rf node_modules package-lock.json .next
npm install
```

### DB 락 (SQLite)
백엔드 안 죽었는데 DB 파일 만질 때:
```bash
sudo lsof | grep general_school.db
kill -9 <PID>
```

### 한글 콘솔 깨짐 (Windows PowerShell)
```powershell
chcp 65001    # UTF-8 모드
```
또는 그냥 WSL 사용.

### `.env` 변경 반영 안 됨
백엔드 재시작 필요 (uvicorn `--reload` 켜져 있어도 환경변수는 시작 시점만 읽음).

---

## 12. 폴더 구조 요약

```
general_school/
├── .env                # 각 환경별 비밀 (gitignore)
├── .env.example        # 템플릿
├── .gitignore
├── README.md           # 짧은 소개
├── SETUP.md            # 이 파일 (셋업 가이드)
├── CLAUDE.md           # 개발/운영 상세 가이드 (AI 개발 시 필독)
├── backend/
│   ├── app/
│   │   ├── core/       # 인증, DB, 권한, 암호화
│   │   ├── models/     # SQLAlchemy
│   │   ├── modules/    # 기능별 라우터 + 권한 정의
│   │   └── services/   # LLM 어댑터, PDF, CSV
│   ├── scripts/        # 시드, 정리 명령
│   ├── storage/        # 사용자 업로드 (gitignore 일부)
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── app/        # Next.js App Router
    │   ├── components/
    │   ├── config/     # 메뉴 정의
    │   └── lib/        # API 클라이언트, 인증
    └── package.json
```

---

## 13. 자주 쓰는 한 줄 명령

```bash
# 백엔드 + 프론트 동시 실행 (tmux)
tmux new -s school -d "cd ~/general_school/backend && source venv/bin/activate && DATABASE_URL='sqlite+aiosqlite:///general_school.db' python -m uvicorn app.main:app --host 0.0.0.0 --port 8002"
tmux new -s school-fe -d "cd ~/general_school/frontend && npm run dev"

# 둘 다 종료
tmux kill-session -t school
tmux kill-session -t school-fe

# 로그 보기
tmux attach -t school
# 빠져나오기: Ctrl+B 다음 D
```
