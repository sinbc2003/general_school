#!/usr/bin/env bash
# .env의 *_SECRET / *_KEY / *_TOKEN 값을 강한 랜덤으로 채우는 헬퍼.
#
# 작동:
#   - .env가 "change-me..." 또는 빈값이면 새 키 생성
#   - 이미 강한 키면 그대로 둠 (멱등)
#   - 변경 전 .env.backup으로 백업
#
# 실행:
#   bash production/scripts/generate-prod-keys.sh

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$INSTALL_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$INSTALL_DIR/.env.example" ]; then
        echo "[INFO] .env 없음 — .env.example 복사"
        cp "$INSTALL_DIR/.env.example" "$ENV_FILE"
    else
        echo "[ERROR] .env, .env.example 모두 없음" >&2
        exit 1
    fi
fi

cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
echo "[OK] .env 백업: $ENV_FILE.backup.*"

# 키 생성 함수
gen_key() {
    python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
}

# 약한/기본 값인지 확인
is_weak() {
    local val="$1"
    # 빈값 / change-me / change-this / "change-" prefix / 32 byte 미만
    [ -z "$val" ] || [[ "$val" =~ ^change ]] || [ ${#val} -lt 32 ]
}

# 키 교체 (있으면 변경, 없으면 추가)
replace_or_add() {
    local key="$1"
    local newval="$2"
    if grep -qE "^${key}=" "$ENV_FILE"; then
        # macOS/Linux sed 호환
        sed -i.tmp -E "s|^${key}=.*|${key}=${newval}|" "$ENV_FILE"
        rm -f "${ENV_FILE}.tmp"
    else
        echo "${key}=${newval}" >> "$ENV_FILE"
    fi
}

# 현재 값 추출
current_val() {
    local key="$1"
    grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

# 검사 대상 — 모두 .env의 핵심 비밀
KEYS=(
    "JWT_SECRET"
    "ENCRYPTION_MASTER_KEY"
    "HOCUSPOCUS_INTERNAL_TOKEN"
    "MEILISEARCH_MASTER_KEY"
)

CHANGED=0
for k in "${KEYS[@]}"; do
    cur="$(current_val "$k")"
    if is_weak "$cur"; then
        newval="$(gen_key)"
        replace_or_add "$k" "$newval"
        echo "[GEN] $k 새 키 생성"
        CHANGED=$((CHANGED + 1))
    else
        echo "[OK]  $k 강한 키 유지"
    fi
done

# SUPER_ADMIN_PASSWORD가 기본값(ChangeMe!Initial2026 같이 시작)이면 경고만 (사용자가 직접 정해야)
sap="$(current_val SUPER_ADMIN_PASSWORD)"
if [[ "$sap" =~ ^(ChangeMe|change-me|change_me|password|admin) ]] || [ -z "$sap" ]; then
    echo "[WARN] SUPER_ADMIN_PASSWORD가 기본값. 강한 비밀번호로 직접 교체 必."
    echo "       예: sed -i 's|^SUPER_ADMIN_PASSWORD=.*|SUPER_ADMIN_PASSWORD=<강한비밀번호>|' $ENV_FILE"
fi

# Hocuspocus .env에도 동기화 (있으면)
HOCUS_ENV="$INSTALL_DIR/backend-hocuspocus/.env"
if [ -f "$HOCUS_ENV" ]; then
    htoken="$(current_val HOCUSPOCUS_INTERNAL_TOKEN)"
    if [ -n "$htoken" ]; then
        cp "$HOCUS_ENV" "$HOCUS_ENV.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        if grep -qE "^HOCUSPOCUS_INTERNAL_TOKEN=" "$HOCUS_ENV"; then
            sed -i.tmp -E "s|^HOCUSPOCUS_INTERNAL_TOKEN=.*|HOCUSPOCUS_INTERNAL_TOKEN=${htoken}|" "$HOCUS_ENV"
            rm -f "${HOCUS_ENV}.tmp"
        else
            echo "HOCUSPOCUS_INTERNAL_TOKEN=${htoken}" >> "$HOCUS_ENV"
        fi
        echo "[OK] backend-hocuspocus/.env 동기화"
    fi
fi

echo ""
echo "완료. 변경된 키: $CHANGED개"
echo "다음 단계:"
echo "  1. CORS_ALLOW_ORIGINS, FRONTEND_URL, BACKEND_URL을 학교 도메인/IP로 직접 수정"
echo "  2. SUPER_ADMIN_PASSWORD 직접 강한 비밀번호로 교체"
echo "  3. 서비스 재시작: sudo systemctl restart gs-backend gs-frontend gs-hocuspocus"
