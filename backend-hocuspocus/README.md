# Hocuspocus — General School 협업 문서 서버

Yjs CRDT 기반 실시간 동시 편집(Google Docs 식). FastAPI backend와 함께 사용.

## 역할

- `/classroom/[cid]/docs/[did]` 페이지의 TipTap 에디터 ↔ Hocuspocus ↔ FastAPI 동기화
- 여러 브라우저가 같은 문서를 열어도 충돌 없이 merge
- 1분마다 (또는 마지막 사용자 disconnect 시) FastAPI에 Yjs state snapshot POST

## 의존성

- Node.js 18+ (권장: 20 LTS / 22)
- backend FastAPI가 같은 머신 (또는 LAN) 에서 실행 중일 것

## 환경 변수 (.env)

`.env.example` 복사 후 채우기. 필수:

- `JWT_SECRET` — FastAPI `settings.JWT_SECRET`과 정확히 일치 (HS256).
- `HOCUSPOCUS_INTERNAL_TOKEN` — FastAPI 환경변수와 일치. snapshot POST endpoint 인증에 사용.
- `FASTAPI_URL` — 기본 `http://localhost:8002`.
- `PORT` — 기본 1234.

## 빠른 시작 (개발)

```bash
cd backend-hocuspocus
cp .env.example .env   # 값 채우기
npm install
npm run dev            # tsx watch — 코드 변경 시 자동 재시작
```

서버 로그:
```
[hocuspocus] 협업 문서 서버 시작 — port 1234, fastapi=http://localhost:8002, snapshot=60000ms
```

frontend는 `ws://localhost:1234`로 자동 연결 (CollabEditor 컴포넌트).

## 운영 (학교 환경)

### 옵션 1 — systemd (Linux)

```ini
# /etc/systemd/system/hocuspocus.service
[Unit]
Description=General School Hocuspocus
After=network.target postgresql.service

[Service]
Type=simple
User=schooladmin
WorkingDirectory=/opt/general_school/backend-hocuspocus
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=PORT=1234
Environment=JWT_SECRET=...
Environment=HOCUSPOCUS_INTERNAL_TOKEN=...
Environment=FASTAPI_URL=http://localhost:8002

[Install]
WantedBy=multi-user.target
```

```bash
cd backend-hocuspocus
npm install
npm run build           # → dist/server.js
sudo systemctl enable --now hocuspocus
sudo systemctl status hocuspocus
journalctl -u hocuspocus -f
```

### 옵션 2 — PM2 (Windows·Linux 공통)

```bash
npm install -g pm2
cd backend-hocuspocus
npm install
npm run build
pm2 start dist/server.js --name hocuspocus --env production
pm2 save
pm2 startup            # 부팅 자동 시작
```

### 옵션 3 — Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist ./dist
EXPOSE 1234
CMD ["node", "dist/server.js"]
```

## 작동 원리 요약

1. **연결**: 브라우저가 `ws://host:1234/?token=JWT&documentName=doc-42`
2. **인증**: `onAuthenticate` — JWT 검증 + FastAPI `/api/classroom/docs/42/permission` 호출
3. **로딩**: `onLoadDocument` — FastAPI `/api/classroom/docs/42/yjs-snapshot` GET → Y.applyUpdate
4. **편집**: 클라이언트들의 update를 in-memory Y.Doc에서 자동 merge (CRDT)
5. **저장 (debounce)**: `onChange` → 60초 후 FastAPI `/api/classroom/docs/42/yjs-snapshot` POST
6. **연결 종료**: `onDisconnect` — 즉시 최종 snapshot POST

## 트러블슈팅

- **JWT 인증 실패**: backend의 `settings.JWT_SECRET`과 `.env`의 `JWT_SECRET`이 정확히 일치하는지 확인.
- **snapshot POST 401**: `HOCUSPOCUS_INTERNAL_TOKEN` 양쪽 일치 확인.
- **권한 거부**: `/api/classroom/docs/{did}/permission` 응답 `can_read=false` — backend 라우터의 권한 정책 확인.
- **WebSocket 접속 안 됨**: 방화벽 1234 포트 / nginx WS proxy 헤더 (`Upgrade`, `Connection`).
- **redirect 사용 시**: nginx reverse proxy 설정 예:
  ```nginx
  location /yjs/ {
    proxy_pass http://localhost:1234/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
  }
  ```

## 백업 / 복원

문서 상태는 PostgreSQL `classroom_docs.yjs_state` (LargeBinary) 컬럼에 저장됨.
FastAPI의 전체 백업 ZIP에 자동 포함 — 본 Hocuspocus 서버는 stateless (in-memory만).
재시작 시 빈 상태로 시작 → 첫 사용자 연결 시 DB snapshot 자동 로드.

## 보안

- **외부 노출 금지**: 학교 LAN 내부에서만. 외부에는 nginx로 차단.
- **JWT_SECRET 유출 = 모든 사용자 토큰 위조 가능**. production은 강한 랜덤 키.
- **HOCUSPOCUS_INTERNAL_TOKEN 유출 = 임의 문서 yjs_state 덮어쓰기 가능**. backend 내부에서만 사용.
