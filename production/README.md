# Production 운영 reference — 우분투 헤드리스 서버

학생 1300 + 교사 100 = 1400명을 단일 노트북 서버로 1년 운영하기 위한 production
환경에서 가동 후 daily로 쓰는 명령 reference. 신규 설치 절차는 [DEPLOY_TO_SCHOOL.md](../DEPLOY_TO_SCHOOL.md)와 [DEPLOYMENT_DAY.md](../DEPLOYMENT_DAY.md) 참조.

---

## 사전 조건

- Ubuntu 22.04+ (헤드리스, GUI 없음)
- sudo 권한 있는 일반 사용자
- PostgreSQL 14+ 설치·기동
- 학교 LAN 유선 연결 (Wi-Fi 비추 — 끊김 위험)
- 노트북 절전·슬립·뚜껑닫음 모두 OFF (`logind.conf` `HandleLidSwitch=ignore`)

## 한 방 셋업

```bash
cd ~/general_school   # 코드 clone된 경로
bash scripts/setup-production.sh
```

이 한 줄이 다음을 수행:
1. 시스템 패키지 (nginx, ufw, Node.js 22, gunicorn)
2. Python venv + requirements + `alembic upgrade head`
3. Frontend production build (Next.js standalone)
4. Hocuspocus production build
5. `.env` 강한 키 자동 생성 (JWT/암호화/Hocuspocus token, 약한 값만 교체)
6. systemd 3개 등록 + 부팅 시 자동 시작 + 죽으면 자동 재시작
7. nginx reverse proxy (학교IP/ 로 단일 진입)
8. ufw 방화벽 (22/80만 외부, 3000/8002/1234 차단)
9. 매일 새벽 2시 자동 백업 cron

## 셋업 후 직접 손볼 4가지

1. `.env`의 `FRONTEND_URL`/`BACKEND_URL`/`CORS_ALLOW_ORIGINS`을 학교 도메인 또는 노트북 IP로
2. `.env`의 `SUPER_ADMIN_PASSWORD`을 강한 비밀번호로 (스크립트는 경고만 띄움)
3. (선택) 학교 도메인 + HTTPS — Let's Encrypt 또는 사설 인증서
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d platform.school.kr
   ```
4. (선택) 외장 SSD 마운트 후 `BACKUP_DEST` 환경변수로 백업 경로 변경

---

## 운영 명령

### 상태 확인
```bash
sudo systemctl status gs-backend gs-frontend gs-hocuspocus
# 세 줄 모두 active(running) 떠야 정상

sudo systemctl is-active gs-backend gs-frontend gs-hocuspocus
# 짧은 확인 — "active"만 출력
```

### 실시간 로그
```bash
sudo journalctl -u gs-backend -f
sudo journalctl -u gs-frontend -f
sudo journalctl -u gs-hocuspocus -f
sudo journalctl -u gs-backend -n 100 --no-pager   # 최근 100줄
sudo journalctl -u gs-backend -p err               # 에러만
```

### 재시작
```bash
sudo systemctl restart gs-backend
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus   # 일괄
```

### 코드 업데이트 (학교 방문 또는 원격 ssh)
```bash
cd ~/general_school
git pull
cd backend && ./venv/bin/pip install -r requirements.txt && ./venv/bin/alembic upgrade head && cd ..
cd frontend && npm ci && npm run build && cp -r .next/static .next/standalone/.next/ && cd ..
cd backend-hocuspocus && npm ci && npm run build && cd ..
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

---

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

> **보안 런북 — 키 로테이션 (defense-in-depth)**: 배포 시 부팅 검사(ENV=production
> 디폴트 키 차단)와 **무관하게** `scripts/generate-prod-keys.sh`로 모든 키
> (JWT_SECRET / ENCRYPTION_MASTER_KEY / HOCUSPOCUS_INTERNAL_TOKEN)를 반드시 교체할 것.
> dev 기본값은 git 히스토리에 존재하므로 repo 접근자는 누구나 알 수 있는 값이다.

---

## 자원 권장

- **노트북 사양**: i5 8세대+ / RAM 16GB+ / SSD 256GB+ (512GB+ 권장, 1300명 1년 운영)
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

---

## 백업 시스템 (3계층)

학교 운영 백업은 **3-2-1 백업 규칙**(사본 3개 / 매체 2종 / 외부 1개) 권장.

### 1. 자동 백업 (cron — `production/scripts/backup.sh`)

매일 새벽 2시 cron:
- PostgreSQL `pg_dump` → `db_YYYY-MM-DD.sql.gz`
- `backend/storage/` → `storage_YYYY-MM-DD.tar.gz`
- 30일 보관 (오래된 자동 삭제)

`.env`의 `BACKUP_DEST`로 출력 경로 지정 (기본 `~/gs-backups`).
외장 SSD 운영 시 `BACKUP_DEST=/mnt/backup_ssd` 권장.

확인:
```bash
crontab -l | grep backup
tail /var/log/gs-backup.log
ls -lh ~/gs-backups/   # 또는 BACKUP_DEST 경로
```

### 2. 웹 UI 백업 (`/system/backup`)

super_admin 전용. 전체 데이터 ZIP 다운로드/복원.

**자동 포함**: DB 모든 테이블 (Base.metadata 자동 수집) + `backend/storage/` 디렉터리.

**장비 교체 / 학교 단위 이관 시**:
1. `/system/backup` → ZIP 받기 → 외장 SSD 보관
2. 새 장비에서 `setup-production.sh` 실행 → 첫 가입(super_admin)
3. `/system/backup` 페이지에서 ZIP 업로드 → **자동 복원** (테이블 + 파일 모두)
4. 복원 후 자동 로그아웃 → 새 토큰

### 3. 개인 드라이브 백업 (`/drive` 또는 `/s/drive`)

**개인 사용자**가 학교 옮길 때 본인 자료 챙기는 용도.

- **"백업 ZIP"** — 본인 자료(docs/sheets/decks/surveys/hwps) + 폴더 구조 ZIP
  - 안에 **사람-읽기 형식** 포함: HTML / XLSX / CSV / HWPX
  - 시스템 import 없이 Excel/Word/메모장으로 직접 열기 가능
- **"복원"** — 다른 학교/같은 시스템에서 ZIP 업로드 → 자료 + 폴더 구조 복원
  - 자동 폴더(부서/강좌 등)는 새 학교의 부서/강좌와 자동 매칭 (멱등)
  - 수동 폴더는 새로 생성
- **"Google 백업"** — 본인 Google Drive에 docs/sheets 일괄 export (Google 연동 필요)

학교 이동 시나리오 정리는 [DEPLOY_TO_SCHOOL.md](../DEPLOY_TO_SCHOOL.md) "사고 시 데이터 복구" 절 참조.

---

## 스토리지 셋업 절차 (외장 SSD / NAS)

**1500명 1년 운영 기준 실 사용량 추정**: 300~600GB. 본체 SSD 256GB로는 부족 → 외부 스토리지 필수.

장비 선택 가이드는 [DEPLOY_TO_SCHOOL.md §1.5](../DEPLOY_TO_SCHOOL.md) 참고. 여기는 셋업 명령.

### A. 외장 USB SSD (단순)

1. 외장 SSD를 노트북 USB-C에 꽂는다 → 우분투가 `/media/<user>/<라벨>` 또는 `/mnt/external1`로 자동 마운트
   - 자동 마운트 안 되면: `sudo mkdir /mnt/external1 && sudo mount /dev/sdX1 /mnt/external1`
2. backend process 사용자에게 쓰기 권한 부여:
   ```bash
   sudo chown -R $USER:$USER /mnt/external1   # 또는 /media/$USER/<라벨>
   ```
3. **자동 마운트 영구 등록** (재부팅 시 자동 연결):
   ```bash
   # UUID 확인
   sudo blkid /dev/sdX1
   # /etc/fstab 끝줄 추가 (vim/nano)
   UUID=<위에서 확인한 UUID>  /mnt/external1  ext4  defaults,nofail  0  2
   ```
4. 서버 웹 UI: `/system/storage` → **"자동 감지"** 클릭 → 후보 list에서 SSD 선택 → "등록"
5. active 토글 → 새 업로드 분산 대상에 포함

**백업 SSD 운영 (월 1회 미러)**:
```bash
# active SSD → 백업 SSD 일괄 복사
rsync -av /mnt/external1/ /mnt/backup_ssd/
```

### B. NAS (안전 + 운영 편함)

**예: Synology DS220+ + WD Red HDD 4TB×2**

1. NAS 셋업 (NAS 웹 UI, 30분):
   - NAS 전원 연결 + 학교 LAN 케이블 꽂기
   - NAS 웹 UI 접속 (`http://<NAS-IP>:5000` — Synology Assistant 또는 라우터 DHCP table 확인)
   - 초기 마법사 따라가기: 관리자 계정 → RAID 1 (미러) 선택 → 볼륨 생성
   - "공유 폴더" 만들기 (예: `general_school`)
   - NFS 활성화: 제어판 → 파일 서비스 → NFS → "NFS 서비스 사용" 체크
   - 공유 폴더 권한: 제어판 → 공유 폴더 → general_school → NFS 권한 → 서버 IP만 read/write 허용

2. 서버에서 NFS client 설치 + 마운트:
   ```bash
   sudo apt install -y nfs-common
   sudo mkdir /mnt/nas
   sudo mount -t nfs <NAS-IP>:/volume1/general_school /mnt/nas
   sudo chown -R $USER:$USER /mnt/nas
   ```

3. **부팅 시 자동 마운트** (`/etc/fstab` 끝줄):
   ```
   <NAS-IP>:/volume1/general_school  /mnt/nas  nfs  defaults,nofail,_netdev,soft,timeo=30  0  0
   ```
   - `nofail`: NAS 꺼져 있어도 부팅 진행
   - `_netdev`: 네트워크 준비된 후 마운트
   - `soft,timeo=30`: NAS 응답 없으면 30s 후 포기 (서버가 NAS 다운에 hang 방지)

4. 서버 웹 UI: `/system/storage` → "자동 감지" → `/mnt/nas` 선택 → 등록 → active

5. **NAS 자체 백업**: NAS UI에서 USB SSD 꽂아 "Hyper Backup" 자동 스케줄 (Synology 표준 기능)

### 운영 모니터링

- `/system/storage` 페이지가 6시간 cron으로 mount/사용량을 자동 체크
- 90% 도달 시 최고관리자에게 알림 (24h 쿨다운)
- NAS 다운 / 외장 SSD 분리 시 last_status가 `missing` / `error: ...`로 표시

---

## Storage Volume (외장 SSD 운영)

`/system/storage` 페이지에서 외장 SSD/HDD를 추가 볼륨으로 등록할 수 있다. 6시간 cron이
mount/사용량을 자동 체크하고, 90% 도달 시 최고관리자에게 알림.

**현재 상태 (Phase 2-Q 1단계 완료)**:
- 등록된 볼륨의 mount 상태·사용량 모니터링만 지원
- **실제 업로드는 여전히 `backend/storage/` 고정 디렉터리만 사용**
- 백업 ZIP(`/system/backup`) + cron(`production/scripts/backup.sh`)도 `backend/storage/`만 백업

볼륨 라우팅 통합은 endpoint별 검증 후 단계적으로 진행 예정 (artifacts·assignments 등).

**당장 단일 디스크 용량이 모자란 경우 임시 운용**:
```bash
# backend/storage/를 외장 SSD에 symlink
sudo mkdir /mnt/external1/storage
sudo chown sinbc:sinbc /mnt/external1/storage
mv backend/storage/* /mnt/external1/storage/
rmdir backend/storage
ln -s /mnt/external1/storage backend/storage
```
backup.sh가 symlink 따라가서 정상 백업됨.

---

## 점검 체크리스트 (매월)

- [ ] 디스크 여유 (`df -h` — `backend/storage/` 폭증 확인, 50GB 이하면 정리)
- [ ] PostgreSQL connection 수 (`psql -c "SELECT count(*) FROM pg_stat_activity"`)
- [ ] gs-* 서비스 uptime (`systemctl status gs-*`)
- [ ] 백업 로그 (`tail /var/log/gs-backup.log`)
- [ ] OS 보안 업데이트 (`sudo apt update && sudo apt upgrade`)

---

## 사고 대응

### 서비스가 안 뜸
```bash
sudo journalctl -u gs-backend -n 100 --no-pager     # 최근 100줄
sudo journalctl -u gs-backend -p err                 # 에러만
sudo systemctl restart gs-backend
```

### WebSocket 끊김 반복 (협업 도구)
- nginx의 `proxy_read_timeout 86400s` 확인
- Hocuspocus 로그: `sudo journalctl -u gs-hocuspocus -f`
- 양쪽 `.env`의 `JWT_SECRET` + `HOCUSPOCUS_INTERNAL_TOKEN` 일치 확인

### 메모리 부족
- `free -h`로 확인
- `gs-backend.service`의 `--workers 9`을 6 또는 4로 줄임 (worker당 ~400MB)
- PostgreSQL `shared_buffers` 줄임

### 데이터 복구
1. backup dir의 가장 최근 `db_*.sql.gz` + `storage_*.tar.gz`로 직접 복원, 또는
2. `/system/backup` 페이지 ZIP 다운로드(미리 받아둔) 후 새 장비에 업로드 → 자동 복원

---

## 관련 문서

- 신규 설치 (학교 방문 시): [DEPLOY_TO_SCHOOL.md](../DEPLOY_TO_SCHOOL.md)
- Day 1 step-by-step: [DEPLOYMENT_DAY.md](../DEPLOYMENT_DAY.md)
- dev 환경 설치: [SETUP.md](../SETUP.md)
- 임시 시연 (cloudflared): [DEMO.md](../DEMO.md)
- AI 개발 가이드: [CLAUDE.md](../CLAUDE.md)
