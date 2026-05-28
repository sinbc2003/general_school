# 수성고 배포 — 세션 인계 (2026-05-28)

> D 노트북(윈도우 jump host)에 새로 설치한 Claude Code가 이 파일과 CLAUDE.md만 읽고
> 이어서 작업할 수 있게 정리. 학교 망 정책 + 노트북 역할 + 다음 작업.

## ⚠️ 중요 — 역할 swap (당일 후반 결정)

원래: A=메인서버, B=NFS 스토리지
**변경**: **B=메인서버, A=NFS 스토리지** (사용자가 집에서 B 셋업하면서 결정)

이유:
- A는 학교 유선 outbound 차단으로 git clone/Claude API/apt 다 불가 → 메인서버로 어려움
- B는 집에서 완전 셋업 가능 (외부 인터넷 OK) → 메인서버 최적
- A는 이미 설치돼있고 SSH OK → NFS 서버 패키지만 추가 설치하면 됨
- A의 HDD 465GB가 미사용 → NFS export 경로로 활용

---

## 📡 학교 망 (수성고) 핵심 발견

### IP 망 구조
- **유선 LAN**: `192.168.0.0/24`, 게이트웨이 `192.168.0.1`
- **와이파이 `susung_5g`** (비번 `susung123`): 같은 `192.168.0.0/24` 서브넷이지만 **client isolation 적용** (와이파이 단말 → 유선 단말 ARP 차단)
- **유선 단말끼리는 isolation 없음** (D → A SSH OK)

### 인터넷 outbound 정책
- **유선 LAN: outbound 완전 차단** (ICMP `Destination Host Unreachable` from `10.111.197.104` — 학교 내부 라우터에서 거부). 8.8.8.8 ping 안 됨, DNS 차단, HTTPS 차단.
- **와이파이는 outbound OK** (D Claude Code 설치가 진행 = 외부 인터넷 됨)
- **D 노트북은 어떻게?** 와이파이도 동시 연결됐거나, 학교 IT 정책상 허용 단말 (확인 필요)

### 결과
- A를 학교 유선에만 두면 외부 API 호출 0 → Claude API/GitHub/Tailscale 다 불가
- D를 jump host로 두면 D가 외부 가능 → C(외부)에서 Chrome RD → D → A SSH 구조
- **Tailscale은 학교 유선에서 작동 불가** (outbound 차단). 와이파이라면 가능했을 것.

---

## 💻 노트북 역할 (현재 상태)

| 노트북 | OS | 위치 | 망 | 역할 | 상태 |
|---|---|---|---|---|---|
| **A** | Ubuntu Server 24.04 | 학교 상주 | 학교 유선 (192.168.0.5) | **NFS 스토리지** (역할 변경) — HDD 465GB export | ✅ 설치 완료, SSH 활성. NFS 패키지 설치 대기 |
| **B (main-server)** | Ubuntu Server 24.04.4 LTS | **사용자 집 (셋업 중) → 추후 학교** | 집 와이파이 `192.168.123.175` + Tailscale `100.92.66.61` | **general_school 메인서버** (역할 변경) | ✅ Tailscale 등록, SSH 키 인증, NOPASSWD sudo, 절전·도구 셋업 완료 |
| **C** | Windows 11 (사용자 본인) | 사용자 휴대 | 외부/집 + Tailscale (`100.89.219.102`) | 사용자 작업 노트북 | ✅ 정상 |
| **D** | Windows | 학교 상주 (오늘 받음) | 학교 유선 + 외부 인터넷 OK + Tailscale (`100.80.133.117`) | **Jump host**: Chrome RD Host + Claude Code + (학교 가서) A·B SSH 게이트웨이 | ✅ Tailscale P2P direct 연결 확인 |

### B 노트북 상세 (main-server, 사용자 집에서 셋업 중)
- **호스트명**: `main-server`
- **Wi-Fi IP (현재 집)**: `192.168.123.175/24` (게이트웨이 `192.168.123.1`)
- **Tailscale IP**: `100.92.66.61` (P2P direct 연결 확인)
- **MAC (wlo1)**: `34:7d:f6:b5:68:eb`
- **사용자**: `susung` / 비번 `20260514!@!@` (A와 통일)
- **OS**: Ubuntu Server 24.04.4 LTS
- **디스크**: Samsung SSD 119GB (OS + LVM ubuntu-lv 116GB) + Toshiba HDD 465GB (미사용 — 추후 백업/추가 용량)
- **SSH 접속**:
  - 외부 어디서든: `ssh susung@100.92.66.61` (Tailscale)
  - 집 LAN: `ssh susung@192.168.123.175`
  - 키 인증 완료 (C의 ed25519 등록)
- **sudo**: NOPASSWD 설정됨 (`/etc/sudoers.d/susung`)
- **체크리스트 (집에서 완료한 것)**:
  - ✅ Ubuntu 설치 + apt upgrade
  - ✅ 절전 OFF (sleep/suspend/hibernate/hybrid-sleep masked)
  - ✅ 덮개 닫기 ignore (`/etc/systemd/logind.conf.d/99-lid.conf` drop-in)
  - ✅ 필수 도구: curl, git, wget, build-essential, ca-certificates, ufw
  - ✅ Tailscale 1.98.3 설치 + 등록
  - ✅ SSH 키 인증 + NOPASSWD sudo
- **추가 셋업 (집에서 진행 예정, 다음 세션)**:
  - ⏳ general_school 코드 clone
  - ⏳ PostgreSQL (`scripts/setup_postgres.sh`)
  - ⏳ Node 20 + npm
  - ⏳ Claude Code 설치
  - ⏳ `.env` 작성 (STORAGE_ROOT 포함, JWT/ENCRYPTION_MASTER_KEY 강한 랜덤)
  - ⏳ `bash scripts/setup-production.sh`
- **학교 이동 후**:
  - 학교 LAN에 연결 (와이파이 또는 USB-LAN 어댑터로 유선)
  - IP 변경 (DHCP) — 같은 192.168.0.x 서브넷이면 A와 직접 통신 가능
  - A를 NFS 마운트 (`/mnt/gs-storage` ← A `/srv/gs-storage`)
  - 학교 IT에 outbound 허용 요청 (MAC `34:7d:f6:b5:68:eb`)
- **단방향 SSH**: C/D → B 가능. B에는 다른 곳 SSH 키 없음 (메인서버 보안).

### D 노트북 상세 (수성고)
- **호스트명**: `desktop-e8kcl6l`
- **Tailscale IP**: `100.80.133.117` (P2P direct 연결, 학교 공인 IP `211.114.120.184:41641`)
- **윈도우 사용자**: `user`
- **윈도우 비번**: `260317` (Windows Hello PIN, SSH 비번 인증 X — 키 인증 only)
- **SSH 접속**: `ssh user@100.80.133.117` (키 인증)
- **역할**: C(외부) → SSH → D(학교 유선) → SSH → A(NFS 스토리지) 또는 B(메인서버, 학교 이동 후) 의 jump host
- **체크리스트**:
  - ✅ Tailscale 등록
  - ⏳ OpenSSH 서버 설치 (`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`)
  - ⏳ Chrome RD Host 설치 (보험)
  - ⏳ Claude Code 설치
  - ⏳ 절전 OFF + 자동 로그인 (`netplwiz`)

### A 노트북 상세 (역할 변경 → NFS 스토리지)
- **IP**: `192.168.0.5` (DHCP), 유선 인터페이스 `enp1s0`, MAC `8c:b0:e9:20:98:98`
- **계정**: `susung` / `20260514!@!@`
- **hostname**: `ssh-server`
- **디스크**: SSD 119GB (Samsung) — 사용량 5.8% / 113GB
- **메모리**: 1% 사용
- **부팅 OK**: SSH 활성, sleep.target/suspend.target/hibernate.target/hybrid-sleep.target masked
- **미완료**: 덮개 닫기(lid switch) 설정, general_school 코드 clone, .env 작성, setup-production.sh 실행

### D 노트북 (jump host) 셋업 체크리스트
1. ✅ A에 SSH 가능 확인 (학교 유선끼리 통신 OK)
2. ⏳ Claude Code 설치 (`npm install -g @anthropic-ai/claude-code`)
3. ⏳ Chrome Remote Desktop Host (https://remotedesktop.google.com/access)
4. ⏳ 24/7 가동 (절전 OFF, 덮개 닫기 무시)
5. ⏳ 자동 로그인 (`netplwiz`)
6. ⏳ C에서 외부 Chrome RD 접속 테스트

---

## 🏗️ 운영 구조 (확정)

```
[외부/집]                        [학교 LAN 유선 192.168.0.x]
  C (Windows + Tailscale)          A (Ubuntu Server 192.168.0.5)
   │                                  ├─ general_school backend (8002)
   │                                  ├─ general_school frontend (3000)
   │                                  ├─ hocuspocus (1234)
   │                                  ├─ postgres (5432)
   │                                  └─ SSH
   │                                       ▲
   │ Chrome Remote Desktop                 │ SSH (학교 유선끼리 OK)
   ▼                                       │
  D (Windows, 학교 상주)  ────SSH─────────┘
   ├─ Chrome Remote Desktop Host
   ├─ Claude Code (자연어로 A 제어 + GitHub pull)
   └─ 외부 인터넷 OK
```

**핵심**: 사용자 C는 외부 어디에서든 Chrome RD로 D에 들어가서, D 안에서 `ssh susung@192.168.0.5` 또는 `claude` 명령으로 A를 제어한다.

---

## 🚨 오늘 진행 안 됨 → 다음에

### 1. B 노트북 NFS 셋업 (보류)
- 시간 부족으로 사용자가 B를 집에 가져감
- 집에서 Ubuntu Server 24.04 설치 진행
- 다음 학교 방문 시 가져가서 [SCHOOL_SETUP_2NODE.md](./SCHOOL_SETUP_2NODE.md) Step 1 (NFS 셋업) 진행

### 2. 일단 A 단일 서버로 운영 시작
- B 없이도 A 한 대로 운영 가능 — `STORAGE_ROOT` 기본값 = `backend/storage/`
- 1300명 시작에도 디스크 113GB 충분 (총 예상 용량 350GB 중 초기 사용량 미미)
- B 들어오면 `.env`에 `STORAGE_ROOT=/mnt/gs-storage` 한 줄로 전환

### 3. A 외부 인터넷 — 학교 IT에 부탁 필요
- 현재 A 유선은 outbound 차단 → Claude API 호출/GitHub pull 불가
- **학교 정보교사에게 요청**:
  - "이 서버 노트북 MAC `8c:b0:e9:20:98:98` 외부 인터넷 outbound 허용 부탁"
  - "학교 와이파이에서 이 서버 IP `192.168.0.5`에 접근 가능하게 isolation 예외 처리"
- 안 풀어주면:
  - 챗봇 기능 작동 안 함 (LLM API)
  - 코드 업데이트는 D 거쳐서 SCP (현재 방식)
  - 학생 와이파이로 학교 LMS 접근 불가 → 학생들 유선만 사용

### 4. 학생 접속 망 확인
- 학생들이 평소 학교에서 무엇으로 인터넷 쓰는지 학교 IT에 확인
- 유선이면 OK, 와이파이면 위 isolation 예외 부탁

---

## 🛠 다음 세션이 받을 즉시 행동 (D에서 진행)

### Step A: 사전 확인
1. D에서 `ssh susung@192.168.0.5` 작동? (비번 `20260514!@!@`)
2. D 외부 인터넷 됨? (`ping 8.8.8.8`, `curl https://google.com`)
3. `claude` 명령 동작? Anthropic 인증 완료?

### Step B: A에 general_school 코드 받기
A 자체는 outbound 차단이라 git clone 불가. D에서 받아서 옮김:
```powershell
# D PowerShell
git clone https://github.com/sinbc2003/general_school.git C:\temp\gs
scp -r C:\temp\gs susung@192.168.0.5:~/general_school
```

또는 Claude Code에 자연어 위임:
> "A 노트북(192.168.0.5, susung / 20260514!@!@)에 SSH 들어가서 ~/general_school 디렉토리에 GitHub sinbc2003/general_school 클론하고, .env 파일에 STORAGE_ROOT=/home/susung/general_school/backend/storage 설정해줘. 그리고 bash scripts/setup-production.sh 실행해줘. 막히면 단계별로 알려주고 멈춰줘."

### Step C: A 추가 셋업
D에서 SSH로 A 들어가서:
```bash
# 덮개 닫기 무시 (절전 lid switch)
sudo sed -i 's/#HandleLidSwitch=suspend/HandleLidSwitch=ignore/' /etc/systemd/logind.conf
sudo sed -i 's/#HandleLidSwitchExternalPower=suspend/HandleLidSwitchExternalPower=ignore/' /etc/systemd/logind.conf
sudo systemctl restart systemd-logind

# .env 생성 + 키 발급 (setup-production.sh가 알아서 함)
# scripts/setup-production.sh가 PostgreSQL·Node·gunicorn·nginx·cron 다 설정
```

### Step D: 외부 접속 테스트
- 사용자가 집에 가서 C로 Chrome RD → D 접속
- D 안에서 `ssh susung@192.168.0.5` 가능 확인

---

## 📋 오늘 변경된 코드 (커밋)

| commit | 내용 |
|---|---|
| `fd592d9` | NFS hang timeout + quota UI/API + storage health endpoint + 통합 헬퍼 |
| `75ea33f` | STORAGE_ROOT env var + 15 endpoint 일제 통일 |
| `a674814` | 회귀 테스트 52개 + CLAUDE.md 2026-05-28 섹션 추가 |

**핵심 신규 기능**:
- `STORAGE_ROOT` env var: `.env`에 한 줄로 NFS 전환 (B 들어오면 `/mnt/gs-storage`로)
- Quota 관리 UI: `/users` 페이지 "용량 일괄" 버튼 + 인라인 편집 (super_admin)
- `GET /api/storage/health`: NFS/외장 SSD 상태 한 번에 점검
- NFS 끊김 시 30초 timeout으로 worker 보호

---

## 🔑 사용자 글로벌 컨텍스트 (USB로 D에 복사 권장)

D의 Claude Code는 사용자 글로벌 CLAUDE.md(`C:\Users\sinbc\.claude\CLAUDE.md`)를 모름.
필요시 USB로 복사하거나, 핵심 정보만 여기 옮겨둠:

### 사용자
- 신병철, 고등학교 수학 교사 (`sinbc2003@gmail.com` / `sinbc2003@snu.ac.kr`)
- 미션: 공교육의 반격을 통한 사교육 시장의 붕괴
- 운영: edu-shin.com (생기부 RAG), general_school (1300명용)
- 직접적·간결한 소통 선호

### 클러스터 (Tailscale + SSH)
- Mac1: `100.96.68.48` (허브, M4 16GB)
- Mac2: `100.101.12.127` (메인, M4 16GB, edu-shin.com 호스팅)
- Desktop: `100.111.200.103` (GPU, RTX5080)
- Notebook (C): `100.89.219.102` (사용자 본인)
- Notebook2: `100.92.224.5` (학교 상주)
- OldMac: Mac2 클론 (Notebook2 경유)

### 커맨드센터 API (Mac1, http://100.96.68.48:8080)
- `GET /api/status` — 클러스터 상태
- `GET /api/projects` — 프로젝트 목록
- `POST /api/activity` — 활동 보고: `{"agent":"coka_notebook","machine":"D_jumphost","action":"X","summary":"Y"}`
- `POST /api/office/reply` — 결과 회신: `{"agent_id":"coka_notebook","message":"..."}`
- `POST /api/ports` — 포트 등록: `{"machine":"suseong_A","port":8002,"service":"general_school_backend"}`

### 현재 프로젝트 번호 관련
- 본 작업은 별도 "수성고 배포" 프로젝트 미부여. `general_school` 프로젝트(개발) ↔ "수성고 배포" 분리 가능.
- 필요시 cmd센터에 `POST /api/projects` 로 신규 생성:
  ```
  curl -X POST http://100.96.68.48:8080/api/projects -H "Content-Type: application/json" \
    -d '{"title":"수성고 general_school 배포","assignee":"coka_notebook","description":"D jumphost + A server"}'
  ```

### 행동 원칙
- 간결하게 답함, 불필요한 인사 X
- 외부 작업(메일, 공개 포스트) 반드시 확인 후 실행
- `trash` > `rm` 권장
- SBC Lab 작업: `C:\Users\sinbc\Desktop\sbc_lab\` 하위에서. cokacdir workspace에 만들지 말 것.

---

## 🆘 막힐 때

1. **D에서 `ssh susung@192.168.0.5` 실패**
   - D가 학교 유선 빠졌나 확인 (`ipconfig` → 192.168.0.X 어댑터 있는지)
   - A SSH 켜져있나: D PowerShell에서 `ping 192.168.0.5` → 응답 있으면 IP 도달 OK
   - A 콘솔에서 `sudo systemctl is-active ssh` 확인

2. **D 외부 인터넷 안 됨**
   - 학교 와이파이 연결 (`susung_5g` / `susung123`)
   - 또는 학교 유선이 D는 허용된 단말일 가능성 확인

3. **A에 코드 못 받음**
   - D에서 git clone → scp 방식 사용
   - 또는 USB로 옮김

4. **Claude Code가 cmd센터·클러스터 모름**
   - 사용자 글로벌 CLAUDE.md 복사 안 됨 → USB로 옮기거나 위 "사용자 글로벌 컨텍스트" 섹션을 첫 메시지로 입력
