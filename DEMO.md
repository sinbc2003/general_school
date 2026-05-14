# 데모 시연 가이드 (학교 방문 / 외부 공유용)

`demo-tunnel.bat`로 노트북에서 임시 공개 URL을 만들어 다른 선생님께 보여주는 절차.
Cloudflare Quick Tunnel(가입 불필요, trycloudflare.com 임시 도메인) 사용.

---

## 한 줄 요약

```
1) start-backend.bat 실행 (backend 띄움)
2) demo-tunnel.bat 실행 (frontend + 터널)
3) 출력된 https://xxxx-yyyy.trycloudflare.com URL을 공유
```

---

## 사전 준비

### 1. cloudflared 설치 (한 번만)

```powershell
winget install Cloudflare.cloudflared
```

확인:
```powershell
cloudflared --version
```

### 2. backend 포트 확인

`demo-tunnel.bat` 상단에 기본값:
```
set BACKEND_PORT=8002
```
평소 backend를 8003 또는 다른 포트로 띄우면 이 줄을 수정.

---

## 시연 절차

### 1. backend 띄우기 (별도 창)

```
start-backend.bat
```

콘솔에 `Application startup complete.` 뜨면 성공.

### 2. 평소 띄워둔 frontend(3000)는 **종료** ⚠️

데모는 같은 3000 포트에 **다른 환경변수**로 frontend를 새로 띄움.
평소 frontend가 떠 있으면 포트 충돌 또는 캐시 충돌.

### 3. `demo-tunnel.bat` 실행

스크립트가 자동으로:
- backend 헬스체크
- frontend를 데모 모드(`NEXT_PUBLIC_API_URL=""`, `BACKEND_PROXY_URL=http://localhost:8002`)로 새 창에 띄움
- cloudflared 터널 시작

### 4. URL 공유

출력 예시:
```
+-----------------------------------------+
| Your quick Tunnel has been created!     |
| https://crazy-fox-1234.trycloudflare.com|
+-----------------------------------------+
```

이 URL을 선생님께 공유. 그분들 브라우저에서 회원가입 / 로그인 / 학생 페이지 둘러보기 가능.

### 5. 시연 종료

- 터널 창에서 `Ctrl+C` → cloudflared 종료
- frontend(데모) 창 닫기
- (선택) backend 창 닫기
- 평소 dev 흐름 복귀: `start-frontend.bat`

---

## 보안 주의사항

- `trycloudflare.com` URL은 **누구나 접속 가능**. 회원가입 화면도 열려 있음.
- 데모 직전에 **첫 가입자(super_admin) 계정의 비밀번호를 강한 값으로** 잠시 바꿔두기 권장.
- 데모 DB가 실제 학생 데이터를 담고 있다면 데모용 사본 DB로 띄우는 게 안전:
  ```
  copy backend\general_school.db backend\general_school_demo.db
  ```
  그리고 `demo-tunnel.bat`이나 backend 환경변수에 `DATABASE_URL=sqlite+aiosqlite:///general_school_demo.db` 사용.
- 시연 끝나면 즉시 `Ctrl+C`로 터널 끊기.

---

## 동작 원리

**평소 dev**:
- frontend는 `NEXT_PUBLIC_API_URL=http://localhost:8002`(또는 8003)로 backend 직접 호출
- 즉 브라우저 → `http://localhost:8002/api/...`

**데모 모드**:
- frontend는 `NEXT_PUBLIC_API_URL=""`로 same-origin 호출
- 브라우저 → `https://xxxx.trycloudflare.com/api/...` → Next.js dev server
- Next.js의 rewrites(`next.config.js`)가 받아서 → `http://localhost:8002/api/...`로 proxy
- 결과적으로 **cloudflared 터널 1개**만 필요 (frontend 3000만 노출)

```
[교사 브라우저]
       ↓ https
[cloudflared edge]
       ↓
[노트북 cloudflared.exe]
       ↓ http://localhost:3000
[Next.js dev server (3000)]
       ├─ /(react pages)   → 그대로 렌더
       └─ /api/* (rewrites) → http://localhost:8002 (backend)
                                      ↓
                              [FastAPI + SQLite]
```

---

## 문제 해결

### "backend가 응답하지 않습니다"
→ `start-backend.bat` 먼저 실행. 콘솔에 startup complete 뜨는지 확인.

### 출력에 URL이 안 나옴
→ Windows 방화벽이 cloudflared를 막았을 수 있음. 첫 실행 시 "허용" 클릭.

### 접속자가 "Internal Server Error"
→ frontend 데모 창의 콘솔 확인. backend가 죽었거나 포트 변경됐을 가능성.

### URL 다시 받고 싶음
→ 터널 창 Ctrl+C → `demo-tunnel.bat` 다시 실행. 매 실행마다 새 URL 발급됨.
