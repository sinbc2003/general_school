# Production 배포 — 우분투 헤드리스 서버

전교생 1300 + 교사 100 = 1400명을 단일 노트북 서버로 1년 운영하기 위한 production 셋업.

## 사전 조건

- Ubuntu 22.04+ (헤드리스, GUI 없음)
- sudo 권한 있는 일반 사용자
- PostgreSQL 14+ 설치·기동
- 학교 LAN 유선 연결 (WiFi 비추)
- 노트북 절전·슬립·뚜껑닫음 모두 OFF (`logind.conf` `HandleLidSwitch=ignore`)

## 한 방 셋업

```bash
cd /home/<user>/general_school   # 코드 clone된 경로
bash scripts/setup-production.sh
```

이 한 줄이 다음을 수행:
1. 시스템 패키지 (nginx, ufw, Node.js 20, gunicorn)
2. Python venv + requirements + `alembic upgrade head`
3. Frontend production build (Next.js standalone)
4. Hocuspocus production build
5. `.env` 강한 키 자동 생성 (JWT/암호화/Hocuspocus token)
6. systemd 3개 등록 + 부팅 시 자동 시작 + 죽으면 자동 재시작
7. nginx reverse proxy (학교IP/ 로 단일 진입)
8. ufw 방화벽 (22/80만 외부, 3000/8002/1234 차단)
9. 매일 새벽 2시 자동 백업 cron

## 셋업 후 직접 손봐야 할 4가지

1. `.env`의 `FRONTEND_URL`/`BACKEND_URL`/`CORS_ALLOW_ORIGINS`을 학교 도메인 또는 노트북 IP로
2. `.env`의 `SUPER_ADMIN_PASSWORD`을 강한 비밀번호로 (스크립트는 경고만 띄움)
3. (선택) 학교 도메인 + HTTPS — Let's Encrypt 또는 사설 인증서
4. (선택) 외장 SSD 마운트 후 `BACKUP_DEST` 환경변수로 백업 경로 변경

## 운영 명령

```bash
# 상태 확인
sudo systemctl status gs-backend gs-frontend gs-hocuspocus

# 실시간 로그
sudo journalctl -u gs-backend -f
sudo journalctl -u gs-hocuspocus -f

# 재시작
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus

# 코드 업데이트 (학교 방문 시)
cd /home/<user>/general_school
git pull
cd backend && ./venv/bin/pip install -r requirements.txt && ./venv/bin/alembic upgrade head && cd ..
cd frontend && npm ci && npm run build && cp -r .next/static .next/standalone/.next/ && cd ..
cd backend-hocuspocus && npm ci && npm run build && cd ..
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

## 디렉터리 구조

```
production/
├── README.md              # 이 문서
├── systemd/               # systemd unit 파일 (템플릿 — __INSTALL_DIR__/__USER__ 치환)
│   ├── gs-backend.service       # gunicorn 9 worker, --timeout 300 (nginx 일치)
│   ├── gs-frontend.service      # Next.js standalone node
│   └── gs-hocuspocus.service    # Yjs WebSocket
├── nginx/
│   └── gs.conf            # reverse proxy + gzip + WebSocket + static cache
└── scripts/
    ├── backup.sh          # DB + storage 백업 (cron 일 1회)
    └── generate-prod-keys.sh    # 약한 키 검출 + 강한 키 교체 (멱등)
```

`scripts/setup-production.sh` (프로젝트 최상위)가 이 디렉터리의 템플릿을 이용해
`/etc/systemd/system/`과 `/etc/nginx/sites-available/`에 설치.

## 자원 권장

- **노트북 사양**: i5 8세대+ / RAM 16GB+ / SSD 256GB+
- **PostgreSQL 튜닝** (16GB 노트북): `/etc/postgresql/*/main/postgresql.conf`
  ```
  shared_buffers = 4GB
  effective_cache_size = 12GB
  work_mem = 50MB
  maintenance_work_mem = 1GB
  random_page_cost = 1.1   # SSD
  ```
  변경 후 `sudo systemctl restart postgresql`

- **UPS** 권장: 5~10만원짜리도 정전 1회 막아줌

## 동접 한계

| 시나리오 | 동접 한계 |
|---|---|
| 페이지 idle (시간표/공지 띄움) | 300~500명 |
| 일반 클릭/조회/저장 | 150~200명 |
| 80명 동시 챗봇 | 무리 없음 (LLM API 비용은 별도) |
| 같은 협업 문서 동접 | **20명 이하 권장** — 모둠별 8명씩 분산 권고 |
| PDF 동시 5건 | 영향 없음 (asyncio.to_thread 적용됨) |

## Storage Volume (외장 SSD 운영)

`/system/storage` 페이지에서 외장 SSD/HDD를 추가 볼륨으로 등록할 수 있다. 6시간 cron이
mount/사용량을 자동 체크하고, 90% 도달 시 최고관리자에게 알림이 간다.

**현재 상태 (Phase 2-Q 1단계 완료)**:
- 등록된 볼륨의 mount 상태·사용량 모니터링만 지원
- **실제 업로드는 여전히 `backend/storage/` 고정 디렉터리만 사용**
- 백업 ZIP(`/system/backup`) + cron(`production/scripts/backup.sh`)도 `backend/storage/`만 백업

볼륨 라우팅 통합은 endpoint별 검증 후 단계적으로 진행 예정 (artifacts·assignments 등).
외장 볼륨에 직접 파일을 옮겨두고 그쪽으로 새 업로드를 받기 시작하려면 후속 마이그레이션을 기다릴 것.

당장 단일 디스크 용량이 모자란 경우, 임시 운용:
- `backend/storage/` 를 외장 SSD에 symlink (예: `ln -s /mnt/external1/storage backend/storage`)
- backup.sh가 따라가서 정상 백업됨

## 점검 체크리스트 (매월)

- [ ] 디스크 여유 (`df -h` — `backend/storage/` 폭증 확인, 50GB 이하면 정리)
- [ ] PostgreSQL connection 수 (`psql -c "SELECT count(*) FROM pg_stat_activity"`)
- [ ] gs-* 서비스 uptime (`systemctl status gs-*`)
- [ ] 백업 로그 (`tail /var/log/gs-backup.log`)
- [ ] OS 보안 업데이트 (`sudo apt update && sudo apt upgrade`)

## 사고 대응

**서비스가 안 뜸**:
```bash
sudo journalctl -u gs-backend -n 100 --no-pager     # 최근 100줄
sudo journalctl -u gs-backend -p err                 # 에러만
```

**WebSocket이 끊김 반복**:
- nginx의 `proxy_read_timeout 86400s` 확인
- Hocuspocus 로그: `sudo journalctl -u gs-hocuspocus -f`

**메모리 부족**:
- `free -h`로 확인
- `gs-backend.service`의 `--workers 9`을 6 또는 4로 줄임 (worker당 ~400MB)
- PostgreSQL `shared_buffers` 줄임

**데이터 복구**:
- backup dir의 가장 최근 `db_*.sql.gz` + `storage_*.tar.gz`
- 또는 `/system/backup` 페이지 ZIP 다운로드 후 새 장비에 업로드 → 자동 복원
