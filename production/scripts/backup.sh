#!/usr/bin/env bash
# General School 자동 백업 — cron 매일 새벽 2시 실행 권장.
#
# 백업 대상:
#   - PostgreSQL DB (pg_dump)
#   - STORAGE_ROOT 디렉터리 (사용자 업로드 파일) — .env의 STORAGE_ROOT를 따라감.
#     단 STORAGE_ROOT이 NFS 마운트면 자동 skip (원본이 이미 원격 서버에 보관 중).
#
# 보관 정책: 30일 이상 된 백업 자동 삭제.
#
# 설정:
#   1. BACKUP_DEST를 외장 SSD/NAS 마운트 경로로 (없으면 ~/gs-backups 기본).
#   2. .env의 DATABASE_URL이 postgresql+asyncpg://USER:PASS@HOST:PORT/DBNAME 형식이면 파싱.
#
# 실행:
#   ./backup.sh
#
# crontab:
#   0 2 * * * /home/sinbc/general_school/production/scripts/backup.sh >> /var/log/gs-backup.log 2>&1

set -euo pipefail

# ── 경로 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$INSTALL_DIR/.env"
# STORAGE_DIR은 .env의 STORAGE_ROOT 파싱 후 결정 (아래 DATABASE_URL 파싱 부근).

# 백업 저장소 — 외장 SSD 마운트 또는 ~/gs-backups
BACKUP_DEST="${BACKUP_DEST:-$HOME/gs-backups}"
DATE="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DEST"

# ── DATABASE_URL 파싱 ──
if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] .env not found: $ENV_FILE" >&2
    exit 1
fi

# ── STORAGE_ROOT 파싱 — 코드 밖 데이터 폴더 지원 ──
# 절대경로면 그대로, 상대경로면 backend/ 기준, 없으면 backend/storage (dev 기본).
STORAGE_ROOT_VAL="$(grep -E '^STORAGE_ROOT=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"
if [ -z "$STORAGE_ROOT_VAL" ]; then
    STORAGE_DIR="$INSTALL_DIR/backend/storage"
elif [ "${STORAGE_ROOT_VAL:0:1}" = "/" ]; then
    STORAGE_DIR="$STORAGE_ROOT_VAL"
else
    STORAGE_DIR="$INSTALL_DIR/backend/$STORAGE_ROOT_VAL"
fi

DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"

if [[ "$DB_URL" =~ ^postgresql ]]; then
    # postgresql+asyncpg://user:pass@host:port/dbname → 부분 추출
    # 한 줄 정규식 파싱
    DB_USER="$(echo "$DB_URL" | sed -E 's|^.*://([^:]+):.*|\1|')"
    DB_PASS="$(echo "$DB_URL" | sed -E 's|^.*://[^:]+:([^@]+)@.*|\1|')"
    DB_HOST="$(echo "$DB_URL" | sed -E 's|^.*@([^:/]+).*|\1|')"
    DB_PORT="$(echo "$DB_URL" | sed -E 's|^.*@[^:]+:([0-9]+)/.*|\1|')"
    DB_NAME="$(echo "$DB_URL" | sed -E 's|^.*/([^/?]+)(\?.*)?$|\1|')"

    DB_FILE="$BACKUP_DEST/db_${DATE}.sql.gz"
    echo "[$(date '+%F %T')] DB backup → $DB_FILE"
    PGPASSWORD="$DB_PASS" pg_dump \
        -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" \
        --no-owner --no-acl \
        "$DB_NAME" | gzip -9 > "$DB_FILE"
    echo "  → $(du -h "$DB_FILE" | cut -f1)"
elif [[ "$DB_URL" =~ ^sqlite ]]; then
    # sqlite 경로 추출
    SQLITE_PATH="$(echo "$DB_URL" | sed -E 's|^sqlite\+aiosqlite:///||')"
    if [ ! -f "$SQLITE_PATH" ]; then
        SQLITE_PATH="$INSTALL_DIR/backend/$SQLITE_PATH"
    fi
    DB_FILE="$BACKUP_DEST/db_${DATE}.sqlite.gz"
    echo "[$(date '+%F %T')] SQLite backup → $DB_FILE"
    gzip -c "$SQLITE_PATH" > "$DB_FILE"
else
    echo "[WARN] DATABASE_URL not recognized: $DB_URL — skipping DB backup" >&2
fi

# ── Storage 디렉터리 ──
# NFS/네트워크 마운트 자동 감지 — 같은 디스크/네트워크 안에서 옮겨봐야 의미 없음.
# 또는 BACKUP_STORAGE=false 명시적 끄기.
SKIP_STORAGE_REASON=""
if [ "${BACKUP_STORAGE:-auto}" = "false" ]; then
    SKIP_STORAGE_REASON="BACKUP_STORAGE=false 환경변수 — 명시적 건너뜀"
elif [ -d "$STORAGE_DIR" ]; then
    # STORAGE_DIR이 NFS 마운트인지 검사 (또는 그 안의 실제 경로가 NFS인지)
    STORAGE_REAL="$(readlink -f "$STORAGE_DIR" 2>/dev/null || echo "$STORAGE_DIR")"
    FS_TYPE="$(stat -f -c %T "$STORAGE_REAL" 2>/dev/null || echo unknown)"
    if [[ "$FS_TYPE" == "nfs"* ]]; then
        SKIP_STORAGE_REASON="NFS 마운트 자동 감지 ($STORAGE_REAL, fstype=$FS_TYPE) — 스토리지는 이미 원격 서버에 안전 보관 중"
    fi
fi

if [ -n "$SKIP_STORAGE_REASON" ]; then
    echo "[$(date '+%F %T')] Storage backup 건너뜀: $SKIP_STORAGE_REASON"
elif [ -d "$STORAGE_DIR" ]; then
    STORAGE_FILE="$BACKUP_DEST/storage_${DATE}.tar.gz"
    echo "[$(date '+%F %T')] Storage backup → $STORAGE_FILE"
    tar czf "$STORAGE_FILE" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
    echo "  → $(du -h "$STORAGE_FILE" | cut -f1)"
fi

# ── 30일 이상 정리 ──
echo "[$(date '+%F %T')] Cleaning backups older than 30 days..."
find "$BACKUP_DEST" -name "db_*.sql.gz" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DEST" -name "db_*.sqlite.gz" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DEST" -name "storage_*.tar.gz" -mtime +30 -delete 2>/dev/null || true

echo "[$(date '+%F %T')] Backup complete."
df -h "$BACKUP_DEST" | tail -1
