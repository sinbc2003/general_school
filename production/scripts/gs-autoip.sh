#!/usr/bin/env bash
# 부팅 시 현재 주 IP를 감지해 .env의 URL/CORS를 자동 갱신.
#
# 노트북을 다른 망(집 ↔ 학교)에 옮겨 랜선을 꽂아도 그 IP로 자동 대응 →
# FRONTEND_URL/BACKEND_URL/CORS_ALLOW_ORIGINS 수동 수정이 필요 없게 한다.
#
# gs-autoip.service가 gs-backend/gs-frontend "시작 전에"(Before=) 실행하므로,
# 백엔드는 항상 갱신된 .env를 읽는다.
#
# 사용: gs-autoip [/path/to/.env]   (인자 없으면 $HOME/general_school/.env)
set -euo pipefail

ENV_FILE="${1:-$HOME/general_school/.env}"
if [ ! -f "$ENV_FILE" ]; then
    echo "[gs-autoip] .env 없음: $ENV_FILE — skip" >&2
    exit 0
fi

# 주 LAN IP — 192.168 / 10. / 172.16-31 사설대역 중 첫 번째. (루프백·도커·tailscale 제외)
# 부팅 시 network-online.target이 DHCP IP 할당 완료를 보장 못 하는 경우가 있어
# (너무 일찍 실행되면 IP가 비어 옛 값이 그대로 남음) → IP가 잡힐 때까지 최대 30초 폴링.
LOCAL_IP=""
for _ in $(seq 1 15); do
    LOCAL_IP="$(hostname -I | tr ' ' '\n' | grep -E '^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[01]))' | head -1 || true)"
    [ -n "$LOCAL_IP" ] && break
    sleep 2
done
TS_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"

if [ -z "$LOCAL_IP" ]; then
    echo "[gs-autoip] LAN IP를 30초 대기 후에도 못 찾음 — .env 그대로 둠"
    exit 0
fi

# FRONTEND_URL / BACKEND_URL = http://<LAN IP>  (없으면 추가)
for key in FRONTEND_URL BACKEND_URL; do
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=http://$LOCAL_IP|" "$ENV_FILE"
    else
        echo "${key}=http://$LOCAL_IP" >> "$ENV_FILE"
    fi
done

# CORS = localhost + LAN IP (+ Tailscale IP)
CORS="http://localhost:3000,http://localhost,http://$LOCAL_IP"
[ -n "$TS_IP" ] && CORS="$CORS,http://$TS_IP"
if grep -q '^CORS_ALLOW_ORIGINS=' "$ENV_FILE"; then
    sed -i "s|^CORS_ALLOW_ORIGINS=.*|CORS_ALLOW_ORIGINS=$CORS|" "$ENV_FILE"
else
    echo "CORS_ALLOW_ORIGINS=$CORS" >> "$ENV_FILE"
fi

echo "[gs-autoip] LAN=$LOCAL_IP  TS=${TS_IP:-none}  → .env 갱신 완료"
