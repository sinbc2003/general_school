# 학교 셋업 — 리눅스 깡통 노트북 2대 (서버 + NFS 스토리지)

학교에 리눅스만 설치된 깡통 노트북 2대 받았을 때 따라할 가이드.
원래 3대(서버·DB·미러) 계획에서 1대(미러)는 보류, DB도 분리 안 함 — **서버 노트북에 DB 포함 + 스토리지만 두 번째 노트북에 NFS**.

**다른 시나리오들**:
- 윈도우 노트북에서 우분투 설치부터 시작 → [DEPLOYMENT_DAY.md](./DEPLOYMENT_DAY.md)
- 1대만 있고 시간 압박 → [DEPLOY_TO_SCHOOL.md](./DEPLOY_TO_SCHOOL.md)
- 가동 후 운영 명령 → [production/README.md](./production/README.md)

**구성**:
- **노트북 A** = 서버 (backend·frontend·hocuspocus·PostgreSQL·nginx 모두)
- **노트북 B** = 스토리지 (NFS — backend/storage 호스팅, 자동 백업 destination)
- 본인 노트북 C에서 백업 ZIP 가져와 데이터 복원

**왜 분리?**
- DB는 본체 SSD (네트워크 latency 민감) → A에
- 큰 파일(PDF·문서 300~600GB) → B에 (학교 노트북 SSD 활용)
- 추후 안정성↑ + 본체 SSD 부담↓

**소요 시간**: 2~3시간

---

## 📋 준비물 (집에서, 학교 가기 전)

- [ ] **USB 메모리** — 신병철 노트북 `/system/backup`에서 ZIP 다운로드 받아 복사
- [ ] **랜선 2개 + 공유기/스위치** (이미 학교에 있으면 X)
- [ ] **휴대폰** (GitHub SSH 키 등록용)
- [ ] **메모장** (각 노트북 IP, 비밀번호)
- [ ] **비밀번호 4개 미리 정하기**:
  - `postgres` user 비번
  - `app` DB 비번
  - super_admin 첫 가입 비번
  - NFS 공유 비번 (별도 사용자 만들 거면)

---

## 🎬 9단계 시나리오

### **0. 도착 + 부팅** (5분)

- 두 노트북 켜고 같은 LAN 연결 (공유기/스위치 이더넷)
- 각 노트북에서:
  ```bash
  ip a | grep "inet " | grep -v 127.0.0.1
  ```
- 메모:
  - **노트북 A IP**: ____________ (서버)
  - **노트북 B IP**: ____________ (스토리지)

이 가이드에서는 가정: A = `192.168.1.10`, B = `192.168.1.11`. **본인 IP로 대체해서 사용.**

---

### **1. 노트북 B (스토리지) 셋업** — 10분

```bash
sudo apt update && sudo apt install -y nfs-kernel-server openssh-server

# 스토리지 디렉터리 만들기
sudo mkdir -p /srv/gs-storage
sudo chown nobody:nogroup /srv/gs-storage
sudo chmod 777 /srv/gs-storage

# A 노트북에게만 NFS 접근 허용
sudo bash -c 'echo "/srv/gs-storage 192.168.1.10(rw,sync,no_subtree_check,no_root_squash)" >> /etc/exports'
sudo exportfs -ra
sudo systemctl enable --now nfs-kernel-server

# ── 슬립/절전 모드 영구 OFF (필수!) ──
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# 뚜껑 닫아도 안 자게 (노트북이라 중요)
sudo sed -i 's/#HandleLidSwitch=suspend/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/#HandleLidSwitchExternalPower=suspend/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

# 확인
systemctl status nfs-kernel-server | head -3
sudo exportfs -v
# 출력에 /srv/gs-storage가 보이면 OK
```

✅ **B 노트북 할 일 끝.** 켜둔 채 옆에 두기. 나머지는 A에서.

---

### **2. 노트북 A (서버) 기본 셋업** — 15분

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nfs-common openssh-server

# B의 NFS 마운트 테스트
sudo mkdir -p /mnt/gs-storage
sudo mount -t nfs 192.168.1.11:/srv/gs-storage /mnt/gs-storage
sudo touch /mnt/gs-storage/test && sudo rm /mnt/gs-storage/test
# → 에러 없으면 NFS OK

# 부팅 시 자동 마운트
echo "192.168.1.11:/srv/gs-storage  /mnt/gs-storage  nfs  defaults,nofail,_netdev,soft,timeo=30,retrans=3  0  0" | sudo tee -a /etc/fstab

# A 노트북도 슬립 OFF
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo sed -i 's/#HandleLidSwitch=suspend/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind
```

---

### **3. GitHub SSH 키 + 코드 clone** — 10분

```bash
ssh-keygen -t ed25519 -C "school-server-$(hostname)"
# 모두 Enter (passphrase 없이)

cat ~/.ssh/id_ed25519.pub
# 출력된 ssh-ed25519 ... 를 휴대폰으로 복사
```

휴대폰에서 `github.com/settings/keys` → "New SSH key" → 붙여넣기 → Add.

```bash
# 인증 확인
ssh -T git@github.com
# "Hi sinbc2003!" 나오면 OK

git clone git@github.com:sinbc2003/general_school.git ~/general_school
cd ~/general_school
```

---

### **4. storage 디렉터리를 NFS로 연결** — 2분

**옵션 A (권장, 환경변수)**: `.env`에 `STORAGE_ROOT=/mnt/gs-storage` 한 줄. 모든 업로드가 B로. 코드 수정 0.

**옵션 B (대안, 심볼릭 링크)**:
```bash
cd ~/general_school/backend
rmdir storage 2>/dev/null      # 빈 storage 디렉터리 삭제 (있다면)
ln -s /mnt/gs-storage storage  # NFS 마운트 포인트로 링크
ls -la | grep storage          # storage -> /mnt/gs-storage  로 나오면 OK
```

두 방식 다 동일하게 작동. 옵션 A가 명시적이고 dev/prod 분리 쉬워 권장.

---

### **5. `.env` 작성** — 10분

```bash
cd ~/general_school
nano .env  # 없으면 새 파일
```

**최소 내용** (강한 비밀번호로 교체!):
```bash
ENV=production
SCHOOL_NAME=○○고등학교

# DB (postgres user는 setup-production.sh에서 만듦, 비번도 강하게)
DATABASE_URL=postgresql+asyncpg://app:<강한비번24자이상>@localhost:5432/general_school

# 보안 키 (32자 랜덤 hex)
JWT_SECRET=<openssl rand -hex 32 결과>
ENCRYPTION_MASTER_KEY=<openssl rand -hex 32 결과>

# CORS — 학교 LAN IP
CORS_ALLOW_ORIGINS=http://192.168.1.10

# 파일 저장 root — 모든 업로드(드라이브·과제·연구 등) 여기로 감
# 옵션 A: NFS 마운트 절대경로 → B 노트북에 자동 분리 저장
STORAGE_ROOT=/mnt/gs-storage
# 옵션 B(설정 안 하면): backend/storage/ (CWD 기준) — 옵션 B 심볼릭 링크 방식과 동일

# 백업 destination = NFS = 노트북 B
BACKUP_DEST=/mnt/gs-storage/backups

# GitHub 자동 업데이트 알림 (선택)
GITHUB_UPDATE_REPO=sinbc2003/general_school
```

랜덤 키 생성:
```bash
openssl rand -hex 32  # JWT_SECRET용
openssl rand -hex 32  # ENCRYPTION_MASTER_KEY용
openssl rand -base64 24  # DB 비번용
```

Ctrl+O, Enter, Ctrl+X로 저장.

---

### **6. 자동 셋업 스크립트** — 30분 (대기 위주)

```bash
cd ~/general_school
chmod +x scripts/setup-production.sh
bash scripts/setup-production.sh
```

자동 처리:
- PostgreSQL 설치 + DB·사용자 생성
- Python venv + pip install
- Node modules + Next.js production 빌드
- systemd 서비스 3개 (`gs-backend`·`gs-frontend`·`gs-hocuspocus`) 등록
- nginx 설정 + reload
- ufw (학교 LAN만 허용)
- 매일 새벽 2시 백업 cron (`/mnt/gs-storage/backups` = B 노트북)

**중간에 멈추면 그 단계 메시지 잘 보기.** 의존성 빠지면 `apt install <누락>` 후 다시 실행 (스크립트 멱등).

완료 후 확인:
```bash
sudo systemctl status gs-backend gs-frontend gs-hocuspocus nginx postgresql
# 모두 active (running) 이면 OK
```

---

### **7. 첫 접속 + 데이터 복원** — 15분

학교 다른 PC/태블릿/폰에서 브라우저:
```
http://192.168.1.10/
```

1. **회원가입** — 첫 가입자가 **자동 super_admin** (신병철님)
2. 로그인 → 사이드바 → **시스템 → 백업**
3. **"백업 복원"** 버튼 → USB의 ZIP 파일 업로드
4. 3분 안에 복원 완료 (75 PDF + 사용자 + 매핑 모두)
5. 자동 로그아웃 → 다시 로그인

⚠️ 복원 후 ZIP에 super_admin 계정이 있다면 그게 우선 사용됨. 첫 가입 계정은 일반 권한으로 됨.

---

### **8. 검증** — 10분

브라우저에서:
- [ ] `/past-research` → 75개 PDF 검색·다운로드
- [ ] `/system/onboarding` → 마법사 9단계 진입 가능
- [ ] 학생 테스트 계정 만들기 → `/s/research-submit` 시연
  - 담당교사 매핑 안 됐으면 `/system/research-supervisors`에서 추가
  - 학생이 PDF 제출 → 교사 계정으로 `/research-review`에서 승인 → 학생 산출물 갤러리(`/s/my-portfolio`) 자동 등록 확인
- [ ] `/drive`·`/s/drive` 정상 열림 (DB·NFS 모두 작동)

문제 있으면 systemd 로그:
```bash
sudo journalctl -u gs-backend -n 50
sudo journalctl -u gs-frontend -n 50
```

---

### **9. 운영 인계** — 5분

학교 정보교사·담당자에게 알려주기:
- **접속 URL**: `http://192.168.1.10/`
- **super_admin 계정** (학교에 인계할지, 신병철님이 보관할지 결정)
- **두 노트북 모두 항상 켜둘 것** — 슬립 OFF 이미 설정됨
- **자동 백업**: 매일 새벽 2시 → `/mnt/gs-storage/backups/` (노트북 B). 30일 보관.
- **수동 백업**: 사이드바 → 시스템 → 백업 → 다운로드
- **코드 업데이트 알림**: 사이드바 → 시스템 → 코드 업데이트 (GitHub 새 commit 자동 감지)

---

## 🚨 막힐 수 있는 부분 + 대처

| 문제 | 원인 | 해결 |
|---|---|---|
| `mount.nfs: Connection refused` | B의 NFS 안 떴거나 방화벽 | B에서 `sudo systemctl status nfs-kernel-server` + `sudo ufw allow from 192.168.1.10` |
| `mount.nfs: access denied` | B의 /etc/exports IP 불일치 | B에서 `cat /etc/exports` → A의 실제 IP 맞는지 |
| setup-production.sh 중간 실패 | 패키지·권한 | 메시지 보고 `apt install <누락>` 후 스크립트 재실행 |
| `http://192.168.1.10/` 안 열림 | nginx 또는 ufw | `sudo systemctl status nginx` + `sudo ufw status` + `curl http://localhost/api/health` |
| 백업 ZIP 복원 실패 (디스크 부족) | B의 NFS 마운트 후 용량 확인 | `df -h /mnt/gs-storage` → B 노트북 SSD 여유 확인 |
| B 노트북 갑자기 꺼짐 | 슬립 모드 안 잠갔음 | Step 1의 systemctl mask 다시 + lid switch 설정 |
| GitHub clone "Permission denied" | SSH 키 GitHub 등록 안 됨 | `cat ~/.ssh/id_ed25519.pub` → github.com/settings/keys 에 추가 |
| backend 부팅 실패 | `.env` 키 누락 또는 DB 비번 불일치 | `sudo journalctl -u gs-backend -n 100` 보고 keys 확인 |

---

## 📦 가져갈 체크리스트 (최종)

- [ ] USB (백업 ZIP)
- [ ] 두 노트북 충전기
- [ ] LAN 케이블 2개 (학교 스위치 → 노트북)
- [ ] 휴대폰 (GitHub 등록용)
- [ ] 비밀번호 4개 메모
- [ ] 이 문서 (휴대폰·태블릿으로 보기)

---

## 📊 운영 부하 예상 (1대 + NFS 스토리지)

| 시나리오 | 1대 부담 | 분리 후 |
|---|---|---|
| 1400명 idle | 300+명 OK | 동일 |
| 평범한 클릭/저장 | 150명 안전 | 동일 |
| 동시 챗봇 메시지 | OK (gunicorn 4 worker) | 동일 |
| 동시 파일 다운로드 5건 | DB 부담 X (NFS stream) | NFS LAN 1Gbps = 100MB/s |
| 대용량 파일 업로드 | DB 부담 X | NFS 쓰기 latency 약간 ↑ |
| 백업 시간 | pg_dump 2분 + storage rsync 별도 | NFS면 storage rsync 무관 (이미 B에 있음) |

**1대로 1400명·1년 충분.** 미러 노트북 추가는 추후 안정성 강화용.

---

## 🔄 추후 확장 (학교 운영 안정화 후)

1. **미러 노트북 추가** (안정성 ↑)
   - 노트북 C 추가 → cron으로 매일 pg_dump 보내기 (rsync)
   - 또는 PostgreSQL streaming replication

2. **DB 분리** (성능·안정성 ↑)
   - `.env`의 `DATABASE_URL=postgresql+asyncpg://app:pwd@<DB노트북IP>:5432/general_school` 1줄 변경
   - DB 데이터는 pg_dump → DB 노트북으로 옮김
   - 코드 한 줄도 안 바뀜

3. **외장 SSD 또는 NAS 추가**
   - 노트북 B 대신 NAS → 안정성·용량 ↑
   - `/etc/fstab`의 mount 지점만 변경
