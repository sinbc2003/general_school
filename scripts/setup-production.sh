#!/usr/bin/env bash
# General School — 우분투 헤드리스 서버 production 셋업 (한 방).
#
# 사전 조건:
#   - Ubuntu 22.04+ (헤드리스)
#   - sudo 권한
#   - PostgreSQL 설치·기동 (DATABASE_URL 설정됨)
#   - 코드 clone 완료
#
# 작업:
#   1. 시스템 패키지 (nginx·ufw·gunicorn·node 등)
#   2. Python venv + requirements + alembic upgrade
#   3. Frontend production build (standalone)
#   4. Hocuspocus production build
#   5. .env 강한 키 자동 생성
#   6. systemd 서비스 3개 등록 + 시작
#   7. nginx config 설치 + reload
#   8. ufw 방화벽 (22/80만 외부)
#   9. 자동 백업 cron
#
# 사용:
#   cd /home/sinbc/general_school
#   bash scripts/setup-production.sh
#
# 멱등 — 이미 설정된 항목은 skip.

set -euo pipefail

# ── 환경 검출 ──
INSTALL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(whoami)"
USER_HOME="$HOME"

cd "$INSTALL_DIR"

echo "═══════════════════════════════════════════════════"
echo "  General School Production Setup"
echo "═══════════════════════════════════════════════════"
echo "  Install: $INSTALL_DIR"
echo "  User:    $USER_NAME"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 사전 체크 ──
if [ "$EUID" -eq 0 ]; then
    echo "[ERROR] root로 실행하지 마세요. 일반 사용자로 실행 (sudo는 내부에서 호출)" >&2
    exit 1
fi

if ! command -v sudo >/dev/null; then
    echo "[ERROR] sudo 필요" >&2
    exit 1
fi

if [ ! -d "$INSTALL_DIR/backend" ] || [ ! -d "$INSTALL_DIR/frontend" ]; then
    echo "[ERROR] $INSTALL_DIR가 general_school 프로젝트가 아닙니다" >&2
    exit 1
fi

# ── 1. 시스템 패키지 ──
echo "[1/9] 시스템 패키지 설치..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    nginx ufw \
    python3 python3-venv python3-dev \
    postgresql-client \
    build-essential libpq-dev \
    curl

# Node.js 20+ 확인 (없으면 NodeSource로 설치)
if ! command -v node >/dev/null || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
    echo "  Node.js 20 LTS 설치..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y -qq nodejs
fi
echo "  Node: $(node -v) / npm: $(npm -v)"

# ── 2. Python venv + requirements + alembic ──
echo ""
echo "[2/9] Python venv + 의존성..."
cd "$INSTALL_DIR/backend"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
./venv/bin/pip install -q --upgrade pip
./venv/bin/pip install -q -r requirements.txt
# gunicorn은 requirements.txt에 없을 수 있어 추가 설치
./venv/bin/pip install -q gunicorn

if [ -f "$INSTALL_DIR/.env" ]; then
    echo "  alembic upgrade head..."
    ./venv/bin/alembic upgrade head
else
    echo "  [WARN] .env 없음 — alembic skip. 키 생성 후 직접 'alembic upgrade head' 실행"
fi
cd "$INSTALL_DIR"

# ── 3. Frontend production build ──
echo ""
echo "[3/9] Frontend production build (standalone)..."
cd "$INSTALL_DIR/frontend"

# .env.production — same-origin fetch가 nginx를 통해 backend에 도달하도록 NEXT_PUBLIC_API_URL 빈문자열.
# (안 박으면 lib/api/client.ts가 fallback http://localhost:8002로 빌드 → 브라우저가 본인 PC localhost 호출해 실패)
# 운영자가 학교 IP로 override하고 싶으면 이 파일을 수정 후 재빌드.
if [ ! -f .env.production ]; then
    echo "NEXT_PUBLIC_API_URL=" > .env.production
    echo "  .env.production 생성 (same-origin, nginx 통해 backend 프록시)"
fi

if [ ! -d node_modules ]; then
    npm ci --legacy-peer-deps --silent
fi
npm run build
# next standalone은 static 파일을 별도 복사 必
if [ -d ".next/standalone" ]; then
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/static
    [ -d public ] && cp -r public .next/standalone/public
    echo "  standalone 빌드 완료"
else
    echo "  [WARN] .next/standalone 없음 — next.config.js의 output:'standalone' 확인" >&2
fi
cd "$INSTALL_DIR"

# ── 4. Hocuspocus build ──
echo ""
echo "[4/9] Hocuspocus production build..."
if [ -d "$INSTALL_DIR/backend-hocuspocus" ]; then
    cd "$INSTALL_DIR/backend-hocuspocus"
    if [ ! -d node_modules ]; then
        npm ci --silent
    fi
    npm run build
    cd "$INSTALL_DIR"
else
    echo "  backend-hocuspocus 없음 — skip"
fi

# ── 5. .env 강한 키 ──
echo ""
echo "[5/9] .env 강한 키 검증/생성..."
bash production/scripts/generate-prod-keys.sh

# ── 5b. 데이터 디렉터리 (storage) — OS·코드와 분리 ──
# 사용자 업로드 파일을 코드 폴더(backend/storage) 밖 전용 데이터 폴더로.
# git pull에 안 엮이고 백업 대상도 명확. 기본 $HOME/gs-data/storage.
echo ""
echo "[5b] 데이터 디렉터리 (사용자 업로드 storage)..."
GS_DATA_DIR="${GS_DATA_DIR:-$USER_HOME/gs-data}"
STORAGE_DIR="$GS_DATA_DIR/storage"
mkdir -p "$STORAGE_DIR"
chmod 750 "$GS_DATA_DIR" "$STORAGE_DIR"
if [ -f "$INSTALL_DIR/.env" ]; then
    if ! grep -q '^STORAGE_ROOT=' "$INSTALL_DIR/.env"; then
        echo "STORAGE_ROOT=$STORAGE_DIR" >> "$INSTALL_DIR/.env"
        echo "  .env에 STORAGE_ROOT=$STORAGE_DIR 추가"
    else
        echo "  .env에 STORAGE_ROOT 이미 있음 — 유지"
    fi
else
    echo "  [WARN] .env 없음 — STORAGE_ROOT 미설정. .env 생성 후 STORAGE_ROOT=$STORAGE_DIR 추가 必"
fi
# 기존 backend/storage에 파일 있으면 새 위치로 복사 (멱등, 덮어쓰지 않음). 원본 보존.
OLD_STORAGE="$INSTALL_DIR/backend/storage"
if [ -d "$OLD_STORAGE" ] && [ -n "$(ls -A "$OLD_STORAGE" 2>/dev/null)" ]; then
    echo "  기존 backend/storage 발견 → $STORAGE_DIR 로 복사 (덮어쓰지 않음)..."
    cp -rn "$OLD_STORAGE/." "$STORAGE_DIR/" 2>/dev/null || true
    echo "  복사 완료. 원본(backend/storage)은 보존 — 확인 후 수동 삭제 권장"
fi
echo "  STORAGE_ROOT = $STORAGE_DIR"

# ── 6. systemd 서비스 ──
echo ""
echo "[6/9] systemd 서비스 등록..."
# 자동 IP 감지 스크립트 설치 (gs-autoip.service가 부팅 시 호출 → .env의 IP 자동 갱신)
sudo cp "$INSTALL_DIR/production/scripts/gs-autoip.sh" /usr/local/bin/gs-autoip
sudo chmod +x /usr/local/bin/gs-autoip
for svc in gs-autoip gs-backend gs-frontend gs-hocuspocus; do
    src="$INSTALL_DIR/production/systemd/${svc}.service"
    dst="/etc/systemd/system/${svc}.service"
    if [ ! -f "$src" ]; then
        echo "  [WARN] $src 없음 — skip" >&2
        continue
    fi
    # 템플릿의 placeholder 치환
    sudo bash -c "sed -e 's|__INSTALL_DIR__|${INSTALL_DIR}|g' -e 's|__USER__|${USER_NAME}|g' '$src' > '$dst'"
    echo "  → $dst"
done

sudo systemctl daemon-reload
sudo systemctl enable gs-autoip gs-backend gs-frontend gs-hocuspocus 2>&1 | grep -v 'Created symlink' || true

echo "  서비스 (재)시작..."
# 먼저 gs-autoip — 현재 IP로 .env 갱신 후 백엔드 시작 (백엔드가 갱신된 .env를 읽도록)
sudo systemctl start gs-autoip
sudo systemctl restart gs-backend
sleep 2
sudo systemctl restart gs-frontend
sudo systemctl restart gs-hocuspocus
sleep 2
sudo systemctl --no-pager status gs-backend gs-frontend gs-hocuspocus | grep -E '(●|Active:)' || true

# ── 6b. 노트북 서버 운영 설정 (상태판 + 절전 방지) ──
# 노트북을 24/7 서버로 쓰기 위한 필수 설정:
#   (1) 물리 콘솔(tty1)에 서버 상태판 자동 표시 — 화면 보고 접속주소·상태 확인
#   (2) 절전/최대절전 비활성 + 덮개 닫아도 안 꺼짐 — 잠들면 서버가 중단됨
echo ""
echo "[6b] 노트북 서버 운영 설정 (상태판 + 절전 방지)..."

# (1) 상태판 — /usr/local/bin/gs-status + tty1 자동로그인 + .profile hook
sudo cp "$INSTALL_DIR/production/scripts/gs-status.sh" /usr/local/bin/gs-status
sudo chmod +x /usr/local/bin/gs-status
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf >/dev/null <<GETTY_EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${USER_NAME} --noclear %I \$TERM
GETTY_EOF
PROFILE="$USER_HOME/.profile"
if ! grep -q 'gs-status' "$PROFILE" 2>/dev/null; then
    cat >> "$PROFILE" <<'PROFILE_EOF'

# General School status dashboard on physical console (tty1)
if [ "$(tty)" = "/dev/tty1" ]; then
  gs-status
fi
PROFILE_EOF
fi

# (2) 절전 방지 — sleep/suspend/hibernate mask + 덮개(lid) 이벤트 무시
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
for key in HandleLidSwitch HandleLidSwitchExternalPower HandleLidSwitchDocked; do
    if grep -qE "^#?${key}=" /etc/systemd/logind.conf; then
        sudo sed -i "s|^#\?${key}=.*|${key}=ignore|" /etc/systemd/logind.conf
    else
        echo "${key}=ignore" | sudo tee -a /etc/systemd/logind.conf >/dev/null
    fi
done

sudo systemctl daemon-reload
sudo systemctl restart getty@tty1 2>/dev/null || true
sudo systemctl restart systemd-logind 2>/dev/null || true
echo "  → 상태판: 노트북 화면에 자동 표시 (수동 실행: gs-status)"
echo "  → 절전 방지: sleep mask + 덮개 닫아도 서버 유지"

# ── 7. nginx config ──
echo ""
echo "[7/9] nginx reverse proxy..."
sudo cp "$INSTALL_DIR/production/nginx/gs.conf" /etc/nginx/sites-available/gs
sudo ln -sf /etc/nginx/sites-available/gs /etc/nginx/sites-enabled/gs
# default site 비활성화 (충돌 방지)
sudo rm -f /etc/nginx/sites-enabled/default
if sudo nginx -t 2>&1 | grep -q 'syntax is ok'; then
    sudo systemctl reload nginx
    echo "  nginx reload 완료"
else
    echo "  [ERROR] nginx config syntax error" >&2
    sudo nginx -t
    exit 1
fi

# ── 8. 방화벽 ──
echo ""
echo "[8/9] ufw 방화벽..."
sudo ufw --force enable
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP (nginx)'
# 443은 HTTPS 추후 도입 시 추가
# 3000/8002/1234는 외부 차단 — nginx 경유만
sudo ufw deny 3000/tcp 2>/dev/null || true
sudo ufw deny 8002/tcp 2>/dev/null || true
sudo ufw deny 1234/tcp 2>/dev/null || true
sudo ufw status numbered | head -15

# ── 9. 자동 백업 cron ──
echo ""
echo "[9/9] 자동 백업 cron 설정..."
chmod +x "$INSTALL_DIR/production/scripts/backup.sh"
CRON_LINE="0 2 * * * $INSTALL_DIR/production/scripts/backup.sh >> /var/log/gs-backup.log 2>&1"
# 사용자 crontab에 추가 (중복 방지)
(crontab -l 2>/dev/null | grep -v -F "$INSTALL_DIR/production/scripts/backup.sh" ; echo "$CRON_LINE") | crontab -
sudo touch /var/log/gs-backup.log
sudo chown "$USER_NAME":"$USER_NAME" /var/log/gs-backup.log
echo "  cron: $CRON_LINE"

# ── 마무리 ──
SERVER_IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

═══════════════════════════════════════════════════
  ✓ Production 셋업 완료
═══════════════════════════════════════════════════

접속:
  학교 LAN에서 → http://${SERVER_IP}/

상태 확인:
  sudo systemctl status gs-backend gs-frontend gs-hocuspocus
  sudo journalctl -u gs-backend -f       # 실시간 로그

서비스 재시작 (코드 업데이트 후):
  cd $INSTALL_DIR
  git pull
  cd frontend && npm run build && cp -r .next/static .next/standalone/.next/ && cd ..
  cd backend-hocuspocus && npm run build && cd ..
  cd backend && ./venv/bin/alembic upgrade head && cd ..
  sudo systemctl restart gs-backend gs-frontend gs-hocuspocus

다음 단계 (직접 손봐야 할 것):
  1. .env의 FRONTEND_URL / BACKEND_URL / CORS_ALLOW_ORIGINS을
     학교 도메인 또는 http://${SERVER_IP}로 교체
  2. .env의 SUPER_ADMIN_PASSWORD 강한 비밀번호로 교체
  3. (선택) 학교 도메인 + HTTPS — Let's Encrypt 또는 사설 인증서
  4. (선택) 외장 SSD 마운트 후 BACKUP_DEST 환경변수로 백업 경로 지정

═══════════════════════════════════════════════════
EOF
