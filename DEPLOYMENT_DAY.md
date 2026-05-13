# 학교 셋업 — Day 1 체크리스트

내일 학교 방문해서 따라할 단계별 가이드. 각 박스 [ ] 클릭(또는 동그라미)하며 진행.

**시나리오**:
- 학교에서 윈도우 노트북 2대 받음
- **A** = 제어용 (윈도우 유지, Chrome Remote Desktop 호스트, SSH 클라이언트)
- **B** = 서버용 (윈도우 → 우분투로 교체, 실제 웹 서버)
- 외부에서 본인 노트북 C → Chrome 원격 → A → SSH → B
- B는 외부 차단 (학교 LAN만 허용)

소요 시간: **3~5시간** (설치 다운로드 시간 포함)

---

## 📋 준비물 (학교 가기 전, 집에서)

- [ ] **USB 메모리 8GB 이상** (Ubuntu 부팅용)
- [ ] **외장 SSD 1~2TB** (백업용, 학교에서 살 거면 미리 살 것)
- [ ] **본인 노트북 C** (Ubuntu ISO 다운로드, 명령어 참고용)
- [ ] **랜선 (RJ45)** 2~3개 (노트북에 유선 LAN 포트 없으면 USB-LAN 어댑터)
- [ ] **메모장** (IP·MAC 등 메모)

### USB 부팅 디스크 만들기 (집에서)

1. C 노트북에서 [Ubuntu 22.04 LTS Desktop](https://ubuntu.com/download/desktop) ISO 다운로드 (~5GB)
2. [Rufus](https://rufus.ie) (Windows) 또는 [balenaEtcher](https://www.balena.io/etcher/) 설치
3. USB 꽂고 → Rufus 실행 → ISO 선택 → 시작 → 약 10분 대기
4. USB가 "부팅 가능" 상태가 됨

---

## 🏫 학교 도착 후

### 1️⃣ 노트북 받자마자 정보 메모 (10분)

A, B 둘 다 윈도우 상태에서:

- [ ] A 켜기 → PowerShell 열기 (Windows 키 → "powershell" 검색)
- [ ] A에서:
  ```powershell
  ipconfig /all
  ```
- [ ] **A의 정보 메모 (또는 사진)**:
  - 이더넷 어댑터의 **물리적 주소(MAC)**: `XX-XX-XX-XX-XX-XX`
  - **IPv4 주소(IP)**: `192.168.X.X`
  - **DHCP 사용**: 예/아니요

- [ ] B 켜기 → 같은 작업
- [ ] **B의 정보 메모**: MAC, IP, DHCP 여부

### 2️⃣ 학교 IT에 인사 + 요청 (15~30분)

- [ ] 학교 IT 담당자(전산실/정보부장) 찾아가기
- [ ] 다음 내용 전달:
  ```
  안녕하세요, 임시 운영용 서버 노트북 세팅 중입니다.
  
  1. B 노트북에 우분투를 설치할 예정입니다.
     MAC: XX-XX-XX-XX-XX-XX
     현재 IP: 192.168.X.X
     → 우분투 설치 후에도 같은 IP를 그대로 받을 수 있게 부탁드립니다.
     (가능하면 고정 IP 예약 부탁)
  
  2. 학교 LAN 정보 알려주세요:
     - 게이트웨이 (예: 192.168.0.1)
     - DNS 서버
     - 학교 LAN 대역 (예: 192.168.0.0/24)
  
  3. 외부에서 학교 LAN으로 SSH/RDP는 막혀 있나요?
     (보안상 막혀있길 원해서 외부 접근은 차단 부탁)
  ```
- [ ] **답변 메모**:
  - 학교 LAN 대역: `__________`
  - 게이트웨이: `__________`
  - DNS: `__________`
  - 고정 IP 처리 방식: DHCP 예약 / 수동 입력 / 협조 X

### 3️⃣ 두 노트북 같은 네트워크에 연결 (5분)

- [ ] A, B 둘 다 랜선 또는 학교 WiFi 연결
- [ ] 둘 다 브라우저에서 google.com 접속 OK 확인

---

## 🐧 B 노트북에 우분투 설치 (1시간)

### 4️⃣ 윈도우 백업 (선택, 외장 SSD 있으면)

- [ ] B의 중요 파일(있다면) 외장 SSD로 복사
- [ ] **윈도우 라이센스 키 메모** (나중에 복구할 수도)
  - PowerShell:
    ```powershell
    wmic path softwarelicensingservice get OA3xOriginalProductKey
    ```

### 5️⃣ USB 부팅 → 우분투 설치 (30분~1시간)

- [ ] B에 USB 꽂기
- [ ] B 전원 켜자마자 부팅 키 연타 (제조사마다 다름):
  - Dell: **F12**
  - HP: **F9** 또는 **Esc**
  - Lenovo: **F12** 또는 **Fn+F12**
  - Samsung: **F2** 또는 **F10**
  - LG: **F10**
  - 모르겠으면 BIOS 들어가서 (DEL/F2) Boot Order 변경
- [ ] 부팅 메뉴에서 **USB 선택**
- [ ] "Try or Install Ubuntu" → Enter
- [ ] 언어: **한국어** (또는 English)
- [ ] 키보드: **Korean** (또는 English US)
- [ ] 무선 네트워크 연결 (랜선이면 skip)
- [ ] 업데이트 옵션: **"Normal installation"** + "Download updates" 체크
- [ ] 설치 유형: ⚠️ **"Erase disk and install Ubuntu"** 선택 (윈도우 완전 삭제)
- [ ] 시간대: Seoul
- [ ] 사용자 정보:
  - 이름: `sinbc` (또는 원하는 이름)
  - 컴퓨터 이름: `school-server`
  - 사용자명: `sinbc` ⭐ **메모 필수**
  - 비밀번호: 강한 비밀번호 ⭐ **메모 필수**
  - "Require my password to log in" 선택
- [ ] 설치 진행 (20~40분 대기)
- [ ] "Installation Complete" → **"Restart Now"**
- [ ] USB 뽑으라는 메시지 나오면 USB 제거 → Enter
- [ ] 재부팅 후 우분투 로그인 화면 → 비밀번호 입력 → 데스크탑 표시

### 6️⃣ 우분투 첫 셋업 (15분)

B 우분투에서 **Ctrl + Alt + T**로 터미널 열기:

- [ ] 시스템 업데이트:
  ```bash
  sudo apt update && sudo apt upgrade -y
  ```
  (비밀번호 묻습니다. 입력해도 화면에 안 보이는 게 정상)

- [ ] 필수 도구 설치:
  ```bash
  sudo apt install -y openssh-server git curl ufw net-tools
  ```

- [ ] **B의 IP 확인**:
  ```bash
  hostname -I
  ```
  결과 메모: `_______________`

- [ ] **B의 MAC 확인**:
  ```bash
  ip link show
  ```
  `link/ether` 줄에서 12자리 hex 메모: `_______________`

- [ ] **첫 단계의 메모와 비교**:
  - IP가 같으면 ✅
  - 다르면 → 학교 IT한테 다시 요청 또는 그냥 새 IP로 진행

- [ ] SSH 서버 동작 확인:
  ```bash
  sudo systemctl status ssh
  ```
  초록색 **`active (running)`** 보이면 OK. **q** 키로 빠져나오기.

### 7️⃣ B의 절전·잠금 해제 (24시간 가동용)

- [ ] 좌측 위 **Activities** → "Settings"
- [ ] **Power** → 
  - "Screen Blank": **Never**
  - "Automatic Suspend": **Off**
- [ ] **터미널에서 lid close(덮개) 무시 설정**:
  ```bash
  sudo nano /etc/systemd/logind.conf
  ```
  - 화살표로 내려가서 아래 줄을 찾기 (있으면 # 제거):
    ```
    HandleLidSwitch=ignore
    HandleLidSwitchExternalPower=ignore
    HandleLidSwitchDocked=ignore
    ```
  - 없으면 추가
  - **Ctrl+O** 저장 → **Enter** → **Ctrl+X** 종료
  - 적용:
    ```bash
    sudo systemctl restart systemd-logind
    ```

---

## 🔗 A에서 B로 SSH 연결 (15분)

### 8️⃣ A에서 SSH 접속 테스트

- [ ] A의 PowerShell 열기
- [ ] B로 ping:
  ```powershell
  ping 192.168.0.X
  ```
  (B의 IP, Step 6에서 메모한 거)
- [ ] 응답 오면 ✅. 안 오면:
  - 두 노트북 같은 WiFi에 있는지 확인
  - B에서 `sudo systemctl status ssh` 확인
- [ ] SSH 접속:
  ```powershell
  ssh sinbc@192.168.0.X
  ```
  (`sinbc`는 B 사용자명, `192.168.0.X`는 B의 IP)
- [ ] 첫 접속 시 **"Are you sure you want to continue connecting"** → `yes` + Enter
- [ ] B의 비밀번호 입력 (입력 시 화면에 안 보임)
- [ ] 프롬프트가 `sinbc@school-server:~$` 로 바뀌면 **연결 성공** ✅

### 9️⃣ SSH 키 인증 셋업 (한 번에 끝, 이후 편함)

A의 PowerShell에서 (B에 접속 안 한 상태로 새 창):

- [ ] SSH 키 생성:
  ```powershell
  ssh-keygen -t ed25519 -C "school-control"
  ```
  - 위치: Enter (기본)
  - 패스워드: Enter Enter (없음)

- [ ] 공개키를 B에 복사:
  ```powershell
  type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh sinbc@192.168.0.X "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
  ```
  - B 비밀번호 입력
- [ ] 다시 SSH 접속:
  ```powershell
  ssh sinbc@192.168.0.X
  ```
  - **비밀번호 안 묻고** 바로 접속되면 ✅

---

## 🔒 B 보안 강화 (15분)

A에서 B로 SSH 접속한 상태에서:

### 🔟 SSH 패스워드 인증 끄기 (키만 허용)

- [ ] 설정 파일 열기:
  ```bash
  sudo nano /etc/ssh/sshd_config
  ```
- [ ] 아래 줄들 찾아서 (Ctrl+W로 검색) 다음과 같이 변경:
  ```
  PasswordAuthentication no
  PermitRootLogin no
  ```
  (앞에 `#`이 있으면 제거)
- [ ] Ctrl+O → Enter → Ctrl+X
- [ ] 재시작:
  ```bash
  sudo systemctl restart ssh
  ```
- ⚠️ **A의 키 접속이 안 되면 안 됨**. 다시 새 PowerShell 창에서 `ssh sinbc@...` 테스트.

### 1️⃣1️⃣ 방화벽 — 외부 차단, 학교 LAN만 허용

학교 LAN 대역 확인 (Step 2에서 메모): 예시는 `192.168.0.0/24`

- [ ] B에서:
  ```bash
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow from 192.168.0.0/24 to any port 22
  sudo ufw allow from 192.168.0.0/24 to any port 80
  sudo ufw allow from 192.168.0.0/24 to any port 443
  sudo ufw allow from 192.168.0.0/24 to any port 8002
  sudo ufw allow from 192.168.0.0/24 to any port 3000
  sudo ufw enable
  ```
  (학교 LAN 대역이 `10.X.X.X`나 `172.16.X.X`면 그것에 맞게 변경)

- [ ] 확인:
  ```bash
  sudo ufw status
  ```

### 1️⃣2️⃣ fail2ban (무차별 SSH 시도 차단)

- [ ] 설치:
  ```bash
  sudo apt install -y fail2ban
  sudo systemctl enable --now fail2ban
  ```
- [ ] 확인:
  ```bash
  sudo systemctl status fail2ban
  ```

---

## 🌐 A — Chrome Remote Desktop (외부 C에서 접근용, 20분)

A 화면에서 직접:

### 1️⃣3️⃣ Chrome 설치 + 원격 데스크톱

- [ ] [Chrome](https://www.google.com/chrome/) 설치 (없으면)
- [ ] Chrome 실행 → **본인 Google 계정 로그인** (외부 C에서도 같은 계정 써야 함)
- [ ] https://remotedesktop.google.com/access 접속
- [ ] "원격 액세스 설정" → 호스트 설치
- [ ] 호스트 이름: `school-control` (또는 원하는 이름)
- [ ] **PIN 6자리 이상** 설정 ⭐ 메모 필수
- [ ] 설치 완료

### 1️⃣4️⃣ C(본인 노트북)에서 접속 테스트

- [ ] C에서 같은 Google 계정으로 https://remotedesktop.google.com 접속
- [ ] `school-control` 항목 보임 → 클릭
- [ ] PIN 입력 → **A 화면 표시** ✅
- [ ] A에서 PowerShell 열고 `ssh sinbc@B_IP` → B 접속 가능 확인

---

## 📦 B에 플랫폼 설치 (1~2시간)

A에서 SSH로 B 접속한 상태에서. 또는 B 직접.

### 1️⃣5️⃣ Node.js + Claude Code 설치 (15분)

- [ ] Node.js 22:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
- [ ] Claude Code:
  ```bash
  sudo npm install -g @anthropic-ai/claude-code
  ```
- [ ] 확인:
  ```bash
  claude --version
  ```

### 1️⃣6️⃣ Python + 의존성 (10분)

- [ ] :
  ```bash
  sudo apt install -y python3.12-venv python3.12-dev build-essential libpq-dev
  ```

### 1️⃣7️⃣ GitHub에서 코드 받기 (10분)

- [ ] B에서 SSH 키 생성:
  ```bash
  ssh-keygen -t ed25519 -C "school-server-b"
  cat ~/.ssh/id_ed25519.pub
  ```
- [ ] 출력된 공개키를 복사 → 본인 노트북 C의 브라우저에서 https://github.com/settings/keys → "New SSH key" → 붙여넣기 → 저장
- [ ] B에서 clone:
  ```bash
  cd ~
  git clone git@github.com:sinbc2003/general_school.git
  cd general_school
  ```

### 1️⃣8️⃣ 환경 변수 (.env) 셋업

- [ ] :
  ```bash
  cp .env.example .env
  ```
- [ ] 강한 랜덤 키 2개 생성:
  ```bash
  python3 -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(32))"
  python3 -c "import secrets; print('ENCRYPTION_MASTER_KEY=' + secrets.token_urlsafe(32))"
  ```
  → 출력값 메모

- [ ] `.env` 편집:
  ```bash
  nano .env
  ```
  - `JWT_SECRET=...` 줄을 위에서 생성한 값으로 교체
  - `ENCRYPTION_MASTER_KEY=...` 줄도 교체
  - `SCHOOL_NAME=실제 학교 이름`
  - `DEFAULT_USER_PASSWORD=강한_초기_비밀번호`
  - Ctrl+O → Enter → Ctrl+X

⚠️ **`ENCRYPTION_MASTER_KEY` 별도로 안전 백업** (외장 SSD에 텍스트로). 분실 시 암호화 데이터(LLM API 키 등) 복호화 불가.

### 1️⃣9️⃣ PostgreSQL 설치 (10분, 300명+ 학교)

- [ ] 설치:
  ```bash
  sudo apt install -y postgresql postgresql-contrib
  ```
- [ ] DB · 사용자 생성:
  ```bash
  sudo -u postgres psql
  ```
  ```sql
  CREATE USER app WITH PASSWORD '강한_DB_비밀번호';
  CREATE DATABASE general_school OWNER app;
  GRANT ALL PRIVILEGES ON DATABASE general_school TO app;
  \q
  ```
- [ ] `.env` 다시 편집:
  ```bash
  nano .env
  ```
  - `DATABASE_URL=postgresql+asyncpg://app:강한_DB_비밀번호@localhost:5432/general_school`

### 2️⃣0️⃣ Backend 셋업

- [ ] :
  ```bash
  cd ~/general_school/backend
  python3 -m venv venv
  source venv/bin/activate
  pip install --upgrade pip
  pip install -r requirements.txt
  ```
  (5분 정도)

### 2️⃣1️⃣ Alembic 마이그레이션

- [ ] :
  ```bash
  alembic upgrade head
  ```

### 2️⃣2️⃣ Frontend 셋업

- [ ] :
  ```bash
  cd ~/general_school/frontend
  npm install
  ```
  (2~3분)

### 2️⃣3️⃣ 첫 실행 테스트 (dev 모드)

**터미널 2개 필요**. 학교에서 A 또는 B 직접 두 개 열기.

터미널 1 (백엔드):
- [ ] 
  ```bash
  cd ~/general_school/backend
  source venv/bin/activate
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8002
  ```
  - "Application startup complete" 보이면 OK

터미널 2 (프론트엔드):
- [ ] 
  ```bash
  cd ~/general_school/frontend
  npm run dev
  ```
  - "Ready" 보이면 OK

### 2️⃣4️⃣ 브라우저 접속 + 첫 가입

- [ ] B 또는 다른 학교 PC 브라우저에서:
  ```
  http://192.168.0.X:3000
  ```
  (B의 IP)
- [ ] **"첫 가입자(최고관리자) 등록하기 →"** 링크 클릭
- [ ] 이름/이메일/아이디/비밀번호(8자+) 입력 → 가입 → super_admin 자동
- [ ] 대시보드 진입 확인

### 2️⃣5️⃣ 기본 권한 부여 (Critical, 빠지면 메뉴 안 보임)

- [ ] B의 새 터미널 (백엔드/프론트 띄운 채로):
  ```bash
  cd ~/general_school/backend
  source venv/bin/activate
  python -m scripts.grant_default_roles
  ```
  출력:
  ```
  + teacher 권한 추가: 82
  + staff 권한 추가: 8
  + student 권한 추가: 23
  ```

### 2️⃣6️⃣ 학기 시스템 셋업

- [ ] 브라우저에서 **시스템 → 학기 관리** → 🏫 아이콘 클릭
- [ ] 학교 구조 입력:
  - 학년별 학급 수 (예: 1=10, 2=10, 3=10)
  - 개설 과목 (Enter로 칩 추가)
  - 부서 (예: 수학과, 과학과, 행정실)
  - 저장

### 2️⃣7️⃣ 학교 명단 CSV 업로드 (시간 되면 첫날 / 안 되면 다음날)

- [ ] **시스템 → 학기별 명단** → "CSV 일괄 등록"
- [ ] 교직원 양식 다운로드 → 학교 명단으로 채움 → 업로드
- [ ] 학생 양식 다운로드 → 채움 → 업로드

---

## 💾 외장 SSD 백업 셋업 (30분)

### 2️⃣8️⃣ 외장 SSD 마운트

- [ ] B에 외장 SSD USB 연결
- [ ] :
  ```bash
  lsblk
  ```
  외장 SSD 식별 (예: `sdb1`)
- [ ] :
  ```bash
  sudo blkid /dev/sdb1
  ```
  UUID 메모 (예: `1234-5678-...`)
- [ ] 마운트 폴더:
  ```bash
  sudo mkdir /mnt/backup_ssd
  ```
- [ ] /etc/fstab 등록:
  ```bash
  sudo nano /etc/fstab
  ```
  마지막 줄 추가 (UUID는 본인 것으로):
  ```
  UUID=1234-5678-...  /mnt/backup_ssd  ext4  defaults,nofail  0  2
  ```
  (외장 SSD가 NTFS면 `ntfs`, exFAT면 `exfat` — `blkid` 결과 TYPE 참고)
- [ ] 마운트 + 권한:
  ```bash
  sudo mount -a
  sudo chown sinbc:sinbc /mnt/backup_ssd
  ls /mnt/backup_ssd
  ```

### 2️⃣9️⃣ 자정 자동 백업 cron

- [ ] :
  ```bash
  crontab -e
  ```
  (nano 선택)
- [ ] 아래 추가:
  ```cron
  # 매일 자정: PostgreSQL dump → 외장 SSD
  0 0 * * * pg_dump -F c general_school > /mnt/backup_ssd/db_$(date +\%F).dump 2>>/var/log/school_backup.log
  # 5분 후 storage tar
  5 0 * * * tar czf /mnt/backup_ssd/storage_$(date +\%F).tar.gz ~/general_school/backend/storage/ 2>>/var/log/school_backup.log
  # 60일 보존 (오래된 자동 삭제)
  10 0 * * * find /mnt/backup_ssd -name 'db_*.dump' -mtime +60 -delete
  15 0 * * * find /mnt/backup_ssd -name 'storage_*.tar.gz' -mtime +60 -delete
  ```
- [ ] Ctrl+O → Enter → Ctrl+X
- [ ] 확인:
  ```bash
  crontab -l
  ```

---

## 🚀 Production 모드 전환 (1시간, 운영 안정화 후)

여기까지 오면 dev 모드로 동작 중. **production 셋업은 학교 운영 시작 직전 또는 며칠 안정 운영 후** 진행해도 OK. 빠지면 `SETUP.md` Section 10 참고.

(시간 없으면 dev 모드로 1주일 운영하면서 production은 나중에)

---

## ✅ Day 1 최종 체크

- [ ] B에 우분투 설치 완료
- [ ] A에서 B로 SSH 접속 가능 (키 인증)
- [ ] B 방화벽 활성 (외부 차단)
- [ ] B의 SSH 패스워드 인증 비활성
- [ ] A에 Chrome Remote Desktop 설치 + C에서 접속 확인
- [ ] 플랫폼 설치 (백엔드 + 프론트엔드)
- [ ] 첫 super_admin 가입
- [ ] 기본 권한 부여 스크립트 실행
- [ ] 학교 구조 (학기) 설정
- [ ] 외장 SSD 마운트 + cron 백업

---

## 🆘 트러블슈팅

### "BIOS 부팅 메뉴 못 들어감"
- 전원 켜자마자 부팅 키 **연타** (한 번 누르고 끝 X)
- 잘 안 되면 Windows에서 "고급 시작 옵션" → "재시작 시 펌웨어 진입"

### "B에서 SSH 접속 안 됨"
- B에서: `sudo systemctl status ssh` → active 확인
- A에서: `ping B_IP` → 응답 확인
- B의 ufw: `sudo ufw status` → 22번 ALLOW 확인
- 같은 WiFi/LAN인지 (학교에 게스트망/직원망 분리됐을 수 있음)

### "Chrome Remote Desktop이 C에서 안 보임"
- A와 C 같은 Google 계정인지 확인
- A의 Chrome이 백그라운드에서 실행 중인지 (Chrome 종료하면 호스트도 멈춤)

### "npm install 실패"
- 네트워크 문제 가능. 학교 프록시면 `npm config set proxy ...`
- 디스크 용량: `df -h`

### "PostgreSQL 연결 실패"
- 비밀번호 특수문자 있으면 .env에서 URL encoding 필요 (예: `@` → `%40`)
- `sudo systemctl status postgresql` 확인

### "Alembic upgrade 실패"
- `.env`의 DATABASE_URL 확인
- 처음이면 `alembic stamp head` 한 번 시도

### "외장 SSD 마운트 실패"
- 파일 시스템 형식 확인: `sudo blkid /dev/sdX1`
- ext4가 가장 깔끔. NTFS면 추가 패키지 (`sudo apt install ntfs-3g`)

---

## 📞 도움 요청 시

본인 노트북 C에서 Claude Code 또는 ChatGPT에 다음 정보 전달:
- 어느 단계에서 막혔는지 (예: "Step 1️⃣6️⃣ pip install 실패")
- 정확한 에러 메시지 사진 또는 복사
- 그 직전에 실행한 명령

---

**파이팅! 🚀**
