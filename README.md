# General School 통합 플랫폼

교사·학생 통합 학교 관리 플랫폼. **각 학교가 자체 서버에 설치**해서 사용 (데이터 분리, 학교가 통제).

## 주요 기능
- **학기 시스템** (NEIS 스타일): 학기마다 학생/교직원 명단 스냅샷, 진급/전출 마법사
- **권한 시스템**: 5단계 (super_admin / designated_admin / teacher / staff / student), 매트릭스 편집
- **AI 챗봇**: Anthropic / OpenAI / Google 멀티 프로바이더, 교사·학생 분리
- **학생 포트폴리오**: 성적·수상·논문·상담·모의고사·생기부 + PDF 출력
- **진로·진학 설계**: 학생 본인 / 교사 열람 (정책 토글)
- **대회·과제·동아리·연구**: 학기 격리, 본인 담당 학생만 조회 옵션
- **자료실**: 문서 검색, 문제 DB
- **과거 연구 자료**: 학생·교사 열람

## 기술 스택
- **Backend**: FastAPI + async SQLAlchemy 2.0 + SQLite (개발) / PostgreSQL (운영)
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **인증**: JWT + TOTP 2FA
- **AI**: Anthropic / OpenAI / Google Gemini (관리자가 API 키 등록 후 사용)

## 다른 컴퓨터에 옮기는 방법

**👉 자세한 단계별 가이드: [SETUP.md](./SETUP.md)** (복붙용 명령어 모음)

요약:

### 1. Clone
```bash
git clone <repo-url> general_school
cd general_school
```

### 2. 환경 변수 설정 (필수)
```bash
cp .env.example .env
# .env 파일 열어서 JWT_SECRET, ENCRYPTION_MASTER_KEY 등을 채움
# 강한 랜덤 키 생성:
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 3. 백엔드 셋업
```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 4. 프론트엔드 셋업
```bash
cd ../frontend
npm install
```

### 5. 실행

**백엔드** (포트 8002):
```bash
cd backend
source venv/bin/activate
DATABASE_URL='sqlite+aiosqlite:///general_school.db' \
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8002
```

**프론트엔드** (포트 3000):
```bash
cd frontend
npm run dev
```

브라우저: http://localhost:3000  
초기 로그인: `.env`의 `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`

## 폴더 구조
```
general_school/
├── backend/
│   ├── app/
│   │   ├── core/          # 인증, DB, 권한, 암호화, 설정
│   │   ├── models/        # SQLAlchemy 모델
│   │   ├── modules/       # 기능별 라우터 + 권한 정의
│   │   ├── services/      # LLM 어댑터, PDF 생성, CSV import 등
│   │   └── main.py        # 엔트리포인트
│   ├── scripts/           # 시드, 청소 명령
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/           # Next.js App Router 페이지
│   │   ├── components/    # React 컴포넌트
│   │   ├── config/        # 메뉴 정의
│   │   └── lib/           # API 클라이언트, 인증 컨텍스트
│   └── package.json
├── .env.example           # 환경 변수 템플릿 (.env는 gitignore)
├── .gitignore
├── CLAUDE.md              # 개발 가이드 (AI 개발 시 필독)
└── README.md
```

## 운영 / 보안 참고
- `CLAUDE.md`의 "운영 / 배포" 섹션 참고
- production 배포 시 반드시 `JWT_SECRET`, `ENCRYPTION_MASTER_KEY` 강한 랜덤 키로 교체
- 학생 데이터(성적·상담·생기부)는 2FA 강제됨
- 교내 인트라넷 only로 운영 시 도메인 불필요

## 라이선스
비공개 (학교 운영용).
