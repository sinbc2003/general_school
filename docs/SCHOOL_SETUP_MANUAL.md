# general_school 학교 배포 매뉴얼

> 새 학교 배포 시 이 매뉴얼을 그대로 따라 진행. 학교명·IP·MAC만 바꾸면 됨.
> 새 Claude(AI) 세션이 이 매뉴얼만 읽고 처음부터 끝까지 셋업 가능한 수준.

## 0. 전체 구조 (학교당 4대 노트북)

| 태그 | 역할 | OS | 위치 | 인터넷 |
|---|---|---|---|---|
| **A** | NFS 스토리지 | Ubuntu Server | 학교 상주 (유선) | 학교 망에 따라 outbound 차단 |
| **B** | general_school 운영 (메인) | Ubuntu Server | 학교 상주 (유선/와이파이) | 필수 (LLM API/GitHub) |
| **C** | 사용자(관리자) 작업용 | 사용자 노트북 | 휴대 | 외부 |
| **D** | Jump Host | Windows | 학교 상주 (유선) | 필요 (Tailscale·Chrome RD) |

```
[외부/집]                       [학교 LAN]
   C ──Tailscale SSH──> B (메인서버)
   |  Chrome RD                   |
   v                          NFS |
   D (윈도우 Jump) ──SSH──> A (NFS 스토리지)
```

## 1. GitHub 코드 위치
- 저장소: https://github.com/sinbc2003/general_school
- 브랜치: `main`

## 2. USB 부팅 디스크 (사용자 노트북 C에서)
### 필요한 것
- USB 8GB+
- Rufus: `C:\Users\sinbc\Desktop\sbc_lab\ubuntu_usb\rufus-4.14p.exe`
- ISO: `C:\Users\sinbc\Desktop\sbc_lab\ubuntu_usb\ubuntu-24.04.4-live-server-amd64.iso`

### 절차
1. Rufus 실행
2. 장치: USB (잘못 선택 X — 메인 SSD 날아갈 수 있음)
3. 부팅 선택: "디스크 또는 ISO 이미지" → ISO 열기
4. 파티션: GPT, 대상: UEFI (CSM 없음)
5. 시작 → ISOHybrid 모드 → OK

## 3. 우분투 설치 마법사 (A, B 모두 동일)
| 화면 | 입력 |
|---|---|
| Language | English |
| Keyboard | English (US) |
| Type | Ubuntu Server (minimized X) |
| Network | DHCP (IP 메모) |
| Proxy | 빈 칸 |
| Mirror | 한국 자동 |
| Storage | **SSD 선택** (ESP 파티션 200M vfat 있는 쪽 = 부팅 디스크 = SSD) |
| Storage 상세 | Use entire disk + LVM, LUKS 안 함 |
| ubuntu-lv 크기 | 116GB 최대 확장 권장 |
| Profile A | server `ssh-server` / user `susung` / 비번 메모 |
| Profile B | server `main-server` / user `susung` / 비번 메모 |
| Ubuntu Pro | Skip |
| **SSH** | **Install OpenSSH server [X] Space로 체크 필수** |
| Snaps | 비우고 Done |

## 4. B 노트북 셋업 (집에서 외부 인터넷 OK 상태)

### 4-1. SSH 키 인증 등록 (C에서 PowerShell, 한 번)
```
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh -o StrictHostKeyChecking=accept-new susung@<B IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

### 4-2. NOPASSWD sudo (B SSH 들어가서)
```bash
echo 'susung ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/susung
```

### 4-3. 절전 + 필수 도구
```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo mkdir -p /etc/systemd/logind.conf.d
sudo tee /etc/systemd/logind.conf.d/99-lid.conf <<EOF
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
sudo systemctl restart systemd-logind
sudo apt update && sudo apt install -y curl git wget build-essential ca-certificates ufw
```

### 4-4. Tailscale
```bash
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --hostname=main-server
# 출력 URL을 휴대폰으로 → 클러스터 동일 Google 계정 인증
tailscale ip -4
```

### 4-5. general_school clone + PostgreSQL
```bash
git clone https://github.com/sinbc2003/general_school.git ~/general_school
cd ~/general_school
bash scripts/setup_postgres.sh
# 출력된 DATABASE_URL 복사
```

### 4-6. .env 작성
```bash
cd ~/general_school
cat > .env <<EOF
ENV=production
DATABASE_URL=<위에서 받은 DATABASE_URL>
SCHOOL_NAME=수성고등학교
SCHOOL_SHORT=SUSEONG
STORAGE_ROOT=/home/susung/general_school/backend/storage
FRONTEND_URL=http://<B IP>
BACKEND_URL=http://<B IP>
CORS_ALLOW_ORIGINS=http://localhost,http://<B IP>,http://<B Tailscale IP>
JWT_SECRET=change-this-in-production
ENCRYPTION_MASTER_KEY=change-this-in-production
HOCUSPOCUS_INTERNAL_TOKEN=
BOOTSTRAP_MODE=first_signup
DEFAULT_USER_PASSWORD=school1234!
EOF
chmod 600 .env
```

### 4-7. setup-production.sh
```bash
cd ~/general_school
bash scripts/setup-production.sh
# alembic 실패하면 4-8
```

### 4-8. alembic 의존성 우회 (alembic upgrade head 실패 시)
```bash
sudo -u postgres psql -c "DROP DATABASE IF EXISTS general_school;"
sudo -u postgres psql -c "CREATE DATABASE general_school OWNER app;"
sudo -u postgres psql -d general_school -c "GRANT ALL ON SCHEMA public TO app;"
cd ~/general_school/backend
./venv/bin/python -c "import asyncio; from app.core.database import init_db; from app.models import *; asyncio.run(init_db())"
./venv/bin/alembic stamp head
cd ~/general_school
bash scripts/setup-production.sh
```

### 4-9. 알려진 이슈 (commit 7608fa0 이후 자동 fix됨)
- npm peer dependency 충돌: `--legacy-peer-deps` (자동)
- NEXT_PUBLIC_API_URL 미설정 → 회원가입 비활성: `.env.production` 자동 생성 (자동)
- nginx gzip directive 중복: `sudo sed -i '11,18s/^/# /' /etc/nginx/sites-available/gs && sudo systemctl reload nginx`
- pydantic ValidationError github_update_repo: `.env`에서 그 줄 제거

### 4-10. 수동 6-9 단계 (setup-production.sh 중간에서 멈춤 시)
```bash
INSTALL_DIR=/home/susung/general_school
sudo cp $INSTALL_DIR/production/systemd/gs-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gs-backend gs-frontend gs-hocuspocus
sudo cp $INSTALL_DIR/production/nginx/gs.conf /etc/nginx/sites-available/gs
sudo ln -sf /etc/nginx/sites-available/gs /etc/nginx/sites-enabled/gs
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo ufw --force enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
```

### 4-11. 건강 검진
```bash
sudo systemctl is-active gs-backend gs-frontend gs-hocuspocus nginx
curl -s http://localhost/api/health
# 출력: {"status":"ok","school":"...","version":"1.0.0"}
```

### 4-12. 첫 접속
- 브라우저 → http://<B IP>/auth/register
- 첫 가입자가 자동으로 super_admin
- 메인 페이지(`/`)는 로그인만 표시

## 5. D 노트북 셋업 (Windows Jump Host)

### 5-1. Tailscale
1. https://tailscale.com/download → Windows 설치
2. 시스템 트레이 → Log in → 같은 Google 계정

### 5-2. OpenSSH 서버
1. 설정 → 앱 → 선택적 기능 → "OpenSSH 서버" 검색 → 설치
2. PowerShell 관리자:
```
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 5-3. SSH 키 등록 (C에서)
```
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh user@<D Tailscale IP> "powershell -Command New-Item -ItemType Directory -Force -Path C:\Users\user\.ssh; Add-Content -Path C:\Users\user\.ssh\authorized_keys -Value (Get-Content)"
```

### 5-4. Chrome Remote Desktop (보험)
- https://remotedesktop.google.com/access → 원격 액세스 설정 → PIN 6자리

### 5-5. 24/7 가동 + 자동 로그인
```
powercfg /change standby-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
netplwiz
```

### 5-6. Claude Code (선택)
```
winget install OpenJS.NodeJS.LTS
npm install -g @anthropic-ai/claude-code
```

## 6. 학교 이동 후 B 적응
```bash
NEW_IP=$(hostname -I | awk '{print $1}')
sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=http://${NEW_IP}|" ~/general_school/.env
sed -i "s|BACKEND_URL=.*|BACKEND_URL=http://${NEW_IP}|" ~/general_school/.env
sed -i "s|CORS_ALLOW_ORIGINS=.*|CORS_ALLOW_ORIGINS=http://localhost,http://${NEW_IP},http://<B Tailscale IP>|" ~/general_school/.env
sudo systemctl restart gs-backend gs-frontend
```

## 7. A NFS 스토리지 (학교에서 D 거쳐 A로)

### 접속
```bash
ssh user@<D Tailscale IP>
ssh susung@<A 학교 IP>
```

### A에서 NFS 셋업
```bash
sudo apt install -y nfs-kernel-server
lsblk
sudo umount /dev/sda1 2>/dev/null || true
sudo mkfs.ext4 -F /dev/sda1
sudo mkdir -p /srv/gs-storage
sudo mount /dev/sda1 /srv/gs-storage
echo "/dev/sda1 /srv/gs-storage ext4 defaults 0 2" | sudo tee -a /etc/fstab
sudo chown -R nobody:nogroup /srv/gs-storage
sudo chmod 777 /srv/gs-storage
echo "/srv/gs-storage 192.168.0.0/24(rw,sync,no_subtree_check,no_root_squash)" | sudo tee /etc/exports
sudo exportfs -ra
sudo systemctl enable --now nfs-kernel-server
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

### B에서 A NFS 마운트
```bash
sudo apt install -y nfs-common
sudo mkdir -p /mnt/gs-storage
sudo mount -t nfs <A IP>:/srv/gs-storage /mnt/gs-storage
echo "<A IP>:/srv/gs-storage /mnt/gs-storage nfs defaults,nofail,_netdev,soft,timeo=30 0 0" | sudo tee -a /etc/fstab
sed -i 's|STORAGE_ROOT=.*|STORAGE_ROOT=/mnt/gs-storage|' ~/general_school/.env
sudo systemctl restart gs-backend
```

## 8. 운영 명령어

### 상태/로그/재시작
```bash
sudo systemctl status gs-backend gs-frontend gs-hocuspocus
sudo journalctl -u gs-backend -f
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

### 코드 업데이트
```bash
cd ~/general_school
git pull
cd backend && ./venv/bin/pip install -r requirements.txt && ./venv/bin/alembic upgrade head && cd ..
cd frontend && npm ci --legacy-peer-deps && npm run build && cp -r .next/static .next/standalone/.next/ && cd ..
cd backend-hocuspocus && npm ci && npm run build && cd ..
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

### 백업
- 자동: 매일 새벽 2시 `production/scripts/backup.sh`
- 수동: `bash production/scripts/backup.sh`
- UI 복원: `/system/backup` → "백업 복원" → ZIP 업로드

## 9. 트러블슈팅

### B 셋업 시
| 증상 | 해결 |
|---|---|
| `alembic upgrade head` 실패: relation does not exist | init_db() 우회 (4-8) |
| `npm ci` peer dependency | `--legacy-peer-deps` (7608fa0 이후 자동) |
| nginx gzip duplicate | gs.conf 11-18 주석 |
| pydantic Extra inputs | .env에서 제거 |
| 회원가입 비활성화 메시지 | `.env.production` 자동 생성 (7608fa0 이후 자동) |

### 학교에서
| 증상 | 해결 |
|---|---|
| `ping 8.8.8.8` → Destination Host Unreachable | 학교 IT 또는 와이파이 |
| C(와이파이) → A(유선) SSH timeout | D 경유 또는 학교 IT (와이파이 client isolation) |
| `Connection timed out` | `sudo systemctl enable --now ssh` |
| `Could not resolve host` | `sudo resolvectl dns enp1s0 8.8.8.8 1.1.1.1` |

## 10. 다른 학교 배포 시 변경 사항
1. `data/schools/<new_school_en>/` 디렉토리 생성 + `meta.json` 복사 후 수정
2. `~/shared/command-center/config.py` NODES에 학교 노드 3대 추가
3. cmd center 재시작
4. 매뉴얼 markdown 복사 + 학교명·IP·MAC 치환

## 11. 운영 시작 체크리스트
- [ ] B 학교 망 연결 + IP 업데이트
- [ ] D OpenSSH 설치 + 24/7
- [ ] A NFS 설치 + HDD 마운트 + export
- [ ] B에서 A NFS 마운트 + STORAGE_ROOT 변경
- [ ] 학교 IT 부탁 (outbound + isolation 예외)
- [ ] 첫 super_admin 가입 (`/auth/register`)
- [ ] CSV 학생/교사 일괄 등록 (`/users` 페이지)
- [ ] LLM API 키 등록 (`/system/llm/providers`)
- [ ] cmd 센터 대시보드 헬스 확인

---

## 12. 부록 — 네트워크 기본 개념 (복습)

### 12-1. 사설 IP vs 공인 IP

| 종류 | 예시 | 의미 |
|---|---|---|
| **공인 IP** | `211.114.120.184` | 전세계 유일. 인터넷 라우팅 가능 |
| **사설 IP** | `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x` | LAN 내부만. 인터넷에선 의미 없음 |

비유:
- 공인 IP = 도로명 주소 (전국 어디서든 찾아옴)
- 사설 IP = 아파트 호수 (단지 안에서만 의미)

내 집 `192.168.123.175`와 친구 집 `192.168.123.175`는 서로 모르는 다른 컴퓨터.

### 12-2. NAT (Network Address Translation)

집 공유기가 사설(LAN)과 공인(인터넷) 사이 변환:
- **밖으로**: 모든 사설 IP를 우리 집 공인 IP 하나로 변환
- **밖에서**: "어느 내부 장비로 보낼지 모름" → 차단

내가 구글 접속 = outbound 요청 → 공유기가 기억했다가 응답 받아서 전달.
외부 사람이 우리 집 `192.168.x.x` 접속 시도 = 공유기가 막음.

### 12-3. Tailscale = 사설 VPN 메시

- 각 장비에 `100.x.x.x` 가상 IP 부여
- tailnet 멤버끼리는 같은 가상 LAN처럼 통신
- NAT 뒤에 있어도 P2P 직접 (NAT hole punching) 또는 DERP relay
- 외부 인터넷에서도 같은 tailnet 멤버는 직접 통신

비유: 회사 사내 통신망. 직원이면 집·카페·해외 어디서든 사내 시스템 접근 가능.

### 12-4. 외부 공개 3가지 방법

#### A. 포트포워딩 (옛날, 비추)
- 공유기 설정: "외부 80 → 내부 192.168.x.x:80"
- 외부 사람이 우리 집 공인 IP로 접속 → 공유기가 내부 서버에 전달
- 문제: 보안 위험, 공인 IP 자주 바뀜, 통신사가 막기도, HTTPS 직접 발급

#### B. 클라우드 터널 (현대, 추천)
**역방향 터널** — 내 서버가 클라우드에 outbound 연결 유지, 클라우드가 외부 요청을 그 연결로 전달.

| 도구 | 특징 |
|---|---|
| Cloudflare Tunnel (`cloudflared`) | 무료, 영구 도메인, HTTPS 자동 |
| ngrok | 무료 tier 임시 URL |
| Tailscale Funnel | Tailscale 확장, tailnet 외부 공개 |
| frp | 자체 호스팅 (VPS 필요) |

장점: 포트포워딩 X, 통신사 정책 우회 (outbound만), HTTPS 자동, 안전.
**프로젝트 내 존재**: `demo-tunnel.bat` = Cloudflare Quick Tunnel.

#### C. VPN (Tailscale 등)
- 외부 사용자도 같은 tailnet에 초대
- 학생 1300명은 비현실적이라 운영자(관리자)용만

### 12-5. 학교 운영 시나리오

| 시나리오 | 방법 |
|---|---|
| 학생 1300명 학교 안에서 접속 | 학교 LAN 안에서 직접 (사설 IP). 외부 노출 불필요 |
| 운영자가 집에서 B 제어 | Tailscale (`100.x.x.x`). 안전, 빠름 |
| 외부에서 학생 접속 (방학) | Cloudflare Tunnel 또는 학교 공인 IP + 포트포워딩 + HTTPS |
| 학교 IT가 outbound 막은 경우 | Cloudflare Tunnel은 outbound만 쓰니 우회 가능 |

### 12-6. 정리 3줄

1. 사설 IP는 LAN 안에서만 의미 — 외부에선 보이지 않음 (NAT가 막음)
2. Tailscale은 사설 VPN 메시 — tailnet 멤버끼리는 어디서든 통신
3. 외부 공개는 포트포워딩(옛날) 또는 클라우드 터널(현대) — 클라우드 터널이 안전·편함

---

## 13. 자동 시작 (B 노트북 부팅 시)

전원 ON → 5~10초 부팅 → Wi-Fi 자동 연결 → postgresql → nginx → gs-backend → gs-frontend → gs-hocuspocus → tailscaled 모두 자동.

systemd `enable` 옵션 덕분에 사용자가 콘솔 로그인 안 해도 서비스 다 돈다.

검증:
```bash
systemctl is-enabled gs-backend gs-frontend gs-hocuspocus nginx postgresql tailscaled
# 전부 "enabled"
systemctl is-active gs-backend gs-frontend gs-hocuspocus nginx postgresql tailscaled
# 전부 "active"
```

---

## 14. GitHub 자동 업데이트 시스템 (운영)

### 14-1. 활성화 (한 번만)
`.env`에 한 줄 추가 + backend 재시작:
```bash
echo 'GITHUB_UPDATE_REPO=sinbc2003/general_school' >> ~/general_school/.env
sudo systemctl restart gs-backend
```
→ 24시간마다 자동 polling. 새 commit 감지 시 super_admin에게 in-app 알림.

### 14-2. UI 사용
- `/system/updates` 페이지 진입 (super_admin 또는 `system.updates.view` 권한)
- 현재 commit vs GitHub HEAD 비교 + 차이 commit 목록
- "지금 확인" 버튼 → 즉시 polling
- 새 commit 있으면 **"지금 업데이트 적용"** 빨간 버튼 (`system.updates.apply` 권한)
- "Dry-run (백업만)" 옵션 — 백업만 만들고 변경 X (안전 테스트용)

### 14-3. 자동 적용 9단계
1. **백업** — pg_dump + storage tar.gz (`/tmp/gs-update-backups/`)
2. **from_commit** — 현재 git HEAD 저장 (rollback용)
3. **git pull origin main**
4. **pip install** — backend 의존성 갱신
5. **alembic upgrade head** — DB 스키마 마이그레이션
6. **npm ci + build** — frontend 빌드
7. **(선택) backend-hocuspocus build**
8. **systemctl restart** — gs-backend/frontend/hocuspocus
9. **health check** — `/api/health` 60초 polling

### 14-4. 실패 시 자동 rollback
어느 단계든 실패하면:
- `git reset --hard <from_commit>`
- `pg_restore <백업>`
- `systemctl restart gs-backend gs-frontend gs-hocuspocus`
- UI에 "Rollback 완료" 표시 + 실패 단계 + 에러 로그

**= 데이터 손실 가능성 0**.

### 14-5. 안전망
| 항목 | 보장 |
|---|---|
| 동시 실행 차단 | `/tmp/gs-update.lock` (10분 stale 자동 회수) |
| 진행 상황 polling | 2초마다 `SchoolConfig['system.update.progress']` |
| 마지막 결과 보존 | `SchoolConfig['system.update.last_result']` |
| 시작 전 백업 | 자동 |
| 다운타임 | 1~5초 (Yjs/세션 자동 재연결) |
| audit log | `system.update_apply_start` (is_sensitive=True) |

### 14-6. UI 변경 vs DB 변경 (절대 헷갈리지 말 것)

**둘은 완전히 별개**:

| 변경 위치 | 어디서 | 데이터 영향 |
|---|---|---|
| **UI 변경** | frontend 코드 (TypeScript/React) | ❌ 0 |
| **DB 컬럼 변경** | alembic 마이그레이션 (PostgreSQL ALTER TABLE) | ⚠️ 종류에 따라 |

#### UI만 변경 (데이터 100% 안전 ✅)
- "메뉴에서 동아리 항목 삭제" → frontend 사이드바 코드만 변경 → DB의 `clubs` 테이블 그대로
- "학생 정보 페이지에서 전화번호 안 보이게" → frontend 컴포넌트만 → DB의 `users.phone` 컬럼 그대로
- "버튼 색, 레이아웃, 텍스트 변경" → CSS/JSX만 → DB 무관
- "새 화면 추가" → 새 page.tsx만 → DB 무관

#### DB 컬럼 변경 (alembic 마이그레이션 작성된 경우만)
```python
# alembic/versions/abc_remove_phone.py 같은 파일에
def upgrade():
    op.drop_column('users', 'phone')  # ← 진짜 phone 컬럼의 모든 데이터 영구 삭제
```
이런 마이그레이션 파일이 commit에 포함되면 자동 업데이트가 실행 → 데이터 영향.
**자동 업데이트는 이런 위험 변경을 미리 검출하고 차단** (§14-10 참조).

#### 변경 종류별 데이터 영향 매트릭스
| 변경 종류 | 어디서 | 데이터 |
|---|---|---|
| UI 개선 / 메뉴 추가/삭제 / 라우트 이름 변경 / 페이지 디자인 | frontend | ❌ 없음 |
| 새 컬럼 추가 (nullable) | alembic `add_column` | ❌ 없음 (기존 row는 NULL) |
| 새 테이블 추가 | alembic `create_table` | ❌ 없음 |
| 컬럼 이름 변경 | alembic `alter_column(new_column_name=)` | ✅ 보존 (이름만 변경) |
| **컬럼 삭제** | alembic `drop_column` | ⚠️ 그 컬럼의 모든 row 데이터 영구 삭제 |
| **테이블 삭제** | alembic `drop_table` | ⚠️ 그 테이블의 모든 row 영구 삭제 |
| 데이터 변환 (JSON 스키마 등) | alembic `execute("UPDATE ...")` | ⚠️ 변환 정확해야 |
| major version upgrade | requirements.txt | ⚠️ 신중 검토 |

**핵심**:
- **메뉴/UI = 코드, 데이터 = DB row** → 완전 별개
- **메뉴 없어져도 DB row 그대로** (다른 코드가 다시 표시하면 보임)
- **백업이 만능 안전망** — 자동 업데이트는 시작 전 자동 백업 → 언제든 복원 가능 (`/system/backup`)
- **위험 변경은 dry-run + preflight로 미리 검증** (§14-10)

### 14-7. 권한 설정 (한 번만)
- `system.updates.view` — 기본 super_admin 자동 부여
- `system.updates.apply` — super_admin 자동, designated_admin은 매트릭스에서 부여 필요 (2FA + sensitive)

### 14-8. 트러블슈팅
| 증상 | 원인 | 해결 |
|---|---|---|
| `/system/updates`에서 "환경변수 안내" 표시 | `GITHUB_UPDATE_REPO` 미설정 | `.env`에 추가 + backend 재시작 |
| "이미 진행 중" 409 | lock 파일 남아있음 | 10분 대기 (stale 자동 회수) 또는 `rm /tmp/gs-update.lock` |
| backup 실패 (디스크 부족) | `/tmp` 용량 부족 | `BACKUP_DEST` 환경변수로 다른 경로 지정 |
| alembic 실패 (relation does not exist 등) | 마이그레이션 의존성 | 자동 rollback됨. 수동으로 §4-8 우회 |
| health check 실패 | backend 시작 시간 부족 | 재시작 3회까지 자동, 그래도 실패 시 rollback |
| npm ci 실패 (peer dep) | tiptap 버전 충돌 등 | `--legacy-peer-deps` 자동 (commit 7608fa0 이후) |

### 14-9. 권장 운영 흐름
1. 코드 수정 시 GitHub `main` 직접 push (작은 변경) 또는 PR 머지 (큰 변경)
2. 24시간 내 (또는 즉시 "지금 확인" 버튼) — 슈퍼관리자 알림
3. `/system/updates` 진입 → 변경 commit 목록 + 메시지 검토
4. 위험해 보이면 **"Dry-run"** 먼저 (3분)
5. 문제 없으면 **"지금 업데이트 적용"** → 5~10분 후 완료
6. 실패 시 자동 rollback → 원인 분석 후 코드 수정 + 다시

### 14-10. 충돌 처리 (학교 자체 수정 vs GitHub 본부 변경)

학교는 ai_developer 모듈로 로컬 코드 수정 가능 → **학교 로컬 git과 GitHub `main`이 다이버지**.

#### 자동 검출 (preflight 단계)
자동 업데이트 시작 시 가장 먼저 실행:
1. `git status` → 학교 로컬 미커밋 변경 검출
2. `git log @{u}..HEAD` → 학교 로컬 commit (GitHub에 없는) 검출
3. `git diff HEAD..origin/main alembic/versions/*.py` → 위험 마이그레이션 검출 (`op.drop_column`, `op.drop_table`, `op.execute("DELETE/UPDATE")`)

#### UI에 노란 경고 표시
충돌/위험 감지되면:
- 학교 로컬 미커밋 변경 있음
- 학교 로컬 commit N개 (목록 표시)
- 위험 마이그레이션 N개 (파일명 + 종류)

#### 운영자 결정 옵션
1. **학교 변경 stash 후 강행** 체크박스 → `git stash` → `git pull` → `git stash pop`
   - 성공: 학교 변경 다시 적용됨
   - conflict: 자동 rollback + stash는 `git stash list`에 남아있음
2. **위험 마이그레이션 허용** 체크박스 → `op.drop_column` 같은 변경 진행 (백업으로 복원 가능)
3. **둘 다 미체크**: 차단됨. 운영자가 학교 변경을 본부 GitHub에 PR로 보내거나, dry-run으로 안전성 확인

#### 권장 운영 패턴
- **Phase 1 (~6개월)**: 학교 변경 = 본부 GitHub에 PR로 반영 → 그 후 자동 업데이트
- **Phase 2 (~12개월)**: ai_developer 변경이 자동 PR 생성 (선택)
- **Phase 3**: 학교별 fork 운영 (대규모 커스터마이징 시)

#### 비상 시 학교 변경 보존하면서 GitHub 받기 (수동, SSH)
```bash
cd ~/general_school
# 1. 학교 변경 stash
git stash push -m "school-local-$(date +%Y%m%d)"
# 2. GitHub 최신
git pull origin main
# 3. 학교 변경 다시 적용
git stash pop
# (conflict 발생하면 수동 해결, 또는 git stash list에서 그대로 두기)
```

---

## 15. AI 개발자 운영 가이드 (학교 자체 코드 개선)

학교 super_admin이 `/system/feedback`에서 "AI 개발 요청" → `/system/ai-developer`에서 작업.

### 15-1. AI 개발자가 자동으로 지키는 규칙 (system prompt에 박힘)
- ❌ `op.drop_column`, `op.drop_table` 사용 금지 — 데이터 손실
- ❌ `op.execute("DELETE/UPDATE ...")` 금지
- ✅ 새 컬럼은 nullable 또는 `server_default` 명시
- ✅ 새 파일 추가 우선 (기존 파일 수정 최소화)
- ❌ `CLAUDE.md`, `alembic/versions/`, `app/services/backup.py`, `scripts/setup-production.sh` 수정 금지
- ⚠️ 새 마이그레이션 추가 시 응답 `notes`에 "본부 GitHub에 PR로 반영 권장" 명시

### 15-2. 자동 검증 (변경 적용 전)
- 백업 (in-memory)
- 변경 적용
- pytest 보안/회귀 invariant 검증
- 실패 시 자동 rollback
- 모든 적용/거부/실패는 audit_log (is_sensitive=True)

### 15-3. 운영자 검토 흐름
1. AI 개발자가 생성한 변경 diff 미리보기
2. 변경 내용 + AI의 안내사항 (`notes`) 확인
3. "본부에 PR 권장"이라면 → 본부에 요청 또는 학교에서 commit + push (별도 절차)
4. 안전하면 → 승인 → apply → 자동 회귀 → 운영 시작

### 15-4. AI 개발자 변경 후 GitHub 자동 업데이트와 충돌
- 학교 로컬에만 변경 적용된 상태 → 본부가 GitHub 새 commit push 시 → 자동 업데이트 preflight가 검출 → 운영자 결정 단계 (§14-10)

### 15-5. AI 개발자 미사용 권장 (운영 초기)
운영 초기 (~3개월) 까지는:
- AI 개발자 사용 X
- 변경 필요 시 본부에 요청 → 본부가 GitHub에 push → 학교가 자동 업데이트
- 그래야 충돌 없음, 운영 안정화 후 AI 개발자 활성화
