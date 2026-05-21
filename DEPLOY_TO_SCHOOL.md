# 다른 학교 배포 체크리스트

학교 방문해서 1~2시간에 셋업 완료하기 위한 step-by-step.
`production/README.md`는 기술 상세, 이 문서는 **방문 시 순서대로 따라 할 체크리스트**.

---

## 1. 출발 전 — 챙길 물건

- [ ] **학교용 노트북** (Ubuntu 22.04+ 설치, sudo 사용자 1개 생성, Wi-Fi/유선 둘 다 동작 확인)
- [ ] **외장 SSD** (백업용, 최소 500GB 권장)
- [ ] **유선 LAN 케이블** (Wi-Fi 비추 — 끊김 위험)
- [ ] **UPS** (선택, 5~10만원짜리도 정전 1회 막음)
- [ ] **본인 노트북** (원격 지원·디버깅용)

### 노트북 사전 설정 (집에서 미리)

- [ ] Ubuntu 절전 OFF
  ```bash
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
  ```
- [ ] 뚜껑 닫음 무시 — `/etc/systemd/logind.conf`에서
  ```
  HandleLidSwitch=ignore
  HandleLidSwitchExternalPower=ignore
  ```
- [ ] PostgreSQL 14+ 설치 (`sudo apt install postgresql`)
- [ ] Node.js 20 설치
- [ ] **Tailscale 가입 + 노트북에 설치** (원격 지원 핵심) — `curl -fsSL https://tailscale.com/install.sh | sh`

---

## 2. 학교 도착 후 — IT 담당자와 협의 (10분)

체크리스트:
- [ ] **정적 IP 또는 DHCP 예약** — 노트북 IP가 바뀌면 다 멈춤
- [ ] **포트 80(HTTP) / 443(HTTPS) 학교 LAN 안에서 열림** 확인
- [ ] **학생 Wi-Fi에서 노트북 IP 접속 가능한지** 시험 (예: `ping 10.x.x.x`)
- [ ] **교내 도메인** (예: `platform.school.kr`) 발급 — 선택사항, IP 직접 접속도 OK
- [ ] 노트북 **24시간 켜둘 자리** 확보 (전산실, 교무실 구석 등)
- [ ] 절전·자동업데이트 정책 학교 강제면 예외 요청

---

## 3. 코드 받기 + 셋업 (10분)

```bash
# 학교 노트북에 SSH로 접속 (또는 직접)
cd ~
git clone https://github.com/sinbc2003/general_school.git
cd general_school

# 한 줄 셋업
bash scripts/setup-production.sh
```

이 명령이 자동으로:
- nginx + ufw + Node.js + PostgreSQL용 패키지 설치
- Python venv + alembic upgrade
- Frontend production build
- `.env` 강한 키 생성
- systemd 3개 (gs-backend / gs-frontend / gs-hocuspocus) 등록
- 매일 새벽 2시 백업 cron

### 셋업 후 손볼 4가지 (필수)

- [ ] `.env`의 `FRONTEND_URL` / `BACKEND_URL` / `CORS_ALLOW_ORIGINS` — 학교 IP 또는 도메인으로
- [ ] `.env`의 `SUPER_ADMIN_PASSWORD` — 강한 비밀번호로
- [ ] 외장 SSD 마운트 + `.env`의 `BACKUP_DEST=/mnt/ssd/backups`
- [ ] (선택) HTTPS — Let's Encrypt:
  ```bash
  sudo apt install certbot python3-certbot-nginx
  sudo certbot --nginx -d platform.school.kr
  ```

변경 후:
```bash
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

---

## 4. 초기 데이터 입력 (20~30분)

브라우저에서 `http://노트북IP/` 접속.

- [ ] **첫 가입 = super_admin 자동 부여** — 학교 대표 교사 계정 생성
- [ ] 로그인 후 **🧙 온보딩 마법사** 자동 시작 (8단계):
  1. 환영
  2. 부서 (교무부·학생부·연구부 등 7개 표준 부서 일괄 등록)
  3. 학기 (현재 학기 활성화)
  4. 교사 (CSV 일괄 등록 또는 줄별 입력)
  5. 학생 (CSV 일괄 등록)
  6. 담임 배정
  7. 강좌 자동 생성 (학년부·학급·교과별)
  8. 완료
- [ ] (선택) `/system/integrations/google` → **Google 셋업 마법사** 시작 (Google Drive 연동, 5~10분)
- [ ] (선택) `/system/llm/providers` → Anthropic/OpenAI API 키 등록 + 챗봇 모델 활성화

---

## 5. 동작 확인 (5분)

- [ ] 모든 서비스 active
  ```bash
  sudo systemctl is-active gs-backend gs-frontend gs-hocuspocus
  # 세 줄 모두 "active" 떠야 정상
  ```
- [ ] HTTP 200
  ```bash
  curl -I http://localhost/
  ```
- [ ] 백업 cron 등록됨
  ```bash
  crontab -l | grep backup
  ```
- [ ] 학교 IT 담당자 다른 PC에서 `http://노트북IP/` 접속 → 로그인 시도

---

## 6. 학교에 인계 (30분~1시간)

### 학교 IT 담당자에게 시연

- [ ] systemd 명령:
  ```bash
  sudo systemctl status gs-backend           # 상태
  sudo systemctl restart gs-backend          # 재시작
  sudo journalctl -u gs-backend -f           # 실시간 로그
  ```
- [ ] 백업 확인: `ls /mnt/ssd/backups/` (또는 `BACKUP_DEST` 경로)
- [ ] 디스크 확인: `df -h`

### 학교 대표 교사에게 시연

- [ ] 다른 관리자/교사 계정 추가 (`/system/users`)
- [ ] 학생 CSV 일괄 등록
- [ ] 강좌 만들고 글 올리기
- [ ] 백업 다운로드 (`/system/backup`)
- [ ] 알림 / 시간표 / 클래스룸 기본 흐름

---

## 7. 떠나기 전

- [ ] **Tailscale로 본인 PC에서 학교 노트북에 SSH 가능** 확인
  ```bash
  ssh user@<tailscale-ip>
  ```
- [ ] 모든 super_admin 비밀번호를 학교 측에 인계 (학교 IT 담당자에게)
- [ ] 학교 대표 교사 본인 계정으로 마지막 로그인 가능 확인
- [ ] `EXPLANATION_GUIDE.md` 출력해 학교 IT 담당자에게 전달

---

## 학교마다 다른 부분

코드는 학교마다 동일. **변경할 곳은 admin UI 안에서만**:

| 항목 | 어디서 |
|---|---|
| 학교명 / favicon | `/system/settings` → 사이트 브랜딩 |
| 학년 구성 (1~3 또는 1~6) | `/system/onboarding` → 학기 설정 |
| 부서명 | `/system/departments` |
| 도메인 / IP | `.env`의 `FRONTEND_URL` 등 |
| LLM 모델 (학교 예산에 따라) | `/system/llm/models` |

코드 수정 필요 ❌. **다른 학교라도 같은 git repo 그대로 clone**해서 setup-production.sh 한 번 돌리면 끝.

---

## 원격 지원 (학교 떠난 후)

### 학교 측 "안 됨" 보고 받을 때 절차

1. **Tailscale SSH 접속**
   ```bash
   ssh user@<tailscale-ip>
   ```

2. **서비스 상태 확인**
   ```bash
   sudo systemctl status gs-backend gs-frontend gs-hocuspocus
   ```

3. **로그 확인**
   ```bash
   sudo journalctl -u gs-backend -n 100 --no-pager
   ```

4. **흔한 해결**
   - 서비스 죽었으면: `sudo systemctl restart gs-backend`
   - 디스크 가득 참: `df -h` → 오래된 백업 삭제, 휴지통 비우기
   - PostgreSQL 죽음: `sudo systemctl restart postgresql`

### 코드 업데이트 (원격으로)

```bash
cd ~/general_school
git pull
cd backend && ./venv/bin/pip install -r requirements.txt && ./venv/bin/alembic upgrade head
cd ../frontend && npm ci && npm run build && cp -r .next/static .next/standalone/.next/
cd ../backend-hocuspocus && npm ci && npm run build
sudo systemctl restart gs-backend gs-frontend gs-hocuspocus
```

---

## 사고 시 데이터 복구

1. **백업 ZIP 받기** — `/system/backup` 페이지 또는 외장 SSD의 `db_*.sql.gz` + `storage_*.tar.gz`
2. **새 노트북에서 setup-production.sh 다시 실행**
3. **`/system/backup` 페이지에서 ZIP 업로드** → 자동 복원 (테이블/파일 모두)

---

## FAQ

**Q. 학교가 Workspace(유료 Google) 없는데 Google 연동 되나?**
A. 됨. 일반 Gmail로도 OAuth 동일. 무료. `/system/integrations/google` → 마법사 따라.

**Q. 노트북 1대로 1400명 진짜 가능?**
A. 응. dev mode 한계가 30~80명이고, production(gunicorn 6 worker + nginx + PostgreSQL)이면 동접 200~500명. 1400명이 동시에 클릭은 절대 안 함 — 평소 동접 30~100명.

**Q. 노트북 망가지면?**
A. 외장 SSD에 매일 백업 있음. 새 노트북에서 setup-production.sh → 백업 ZIP 업로드 → 자동 복원. 30분.

**Q. 다른 학교라도 같은 코드?**
A. 응. admin UI에서 학교명 / 학년 / 부서만 다르게 설정. 코드는 git pull로 다 똑같이.

**Q. 학생들이 외부에서 접속해야 하나?**
A. 보통 학교 LAN 안에서만. 외부 접속 필요하면 학교 IT에 포트포워딩 또는 reverse tunnel (Tailscale Funnel) 요청.
