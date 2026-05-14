#!/bin/bash
# WSL Ubuntu에 PostgreSQL 설치 + general_school DB/user 생성.
# 학교 노트북에서도 그대로 재사용 가능.
#
# 사용:
#   chmod +x scripts/setup_postgres.sh
#   ./scripts/setup_postgres.sh
#
# 끝나면 출력되는 DATABASE_URL을 .env와 start-backend.bat에 박을 것.

set -e

DB_NAME=general_school
DB_USER=app
DB_PASS="$(openssl rand -hex 16)"

echo "════════════════════════════════════════════"
echo "  PostgreSQL Setup for $DB_NAME"
echo "════════════════════════════════════════════"
echo

echo "[1/5] apt update + PostgreSQL 설치 (sudo 비밀번호 입력 필요)..."
sudo apt update
sudo apt install -y postgresql postgresql-contrib

echo
echo "[2/5] PostgreSQL 서비스 시작..."
sudo service postgresql start
# WSL에서 systemctl 안 되는 경우 service 사용

echo
echo "[3/5] 기존 DB/user 정리 (있으면)..."
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true

echo
echo "[4/5] DB + user 생성..."
sudo -u postgres psql <<SQL
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
SQL

echo
echo "[5/5] 연결 테스트..."
PGPASSWORD="$DB_PASS" psql -h localhost -U $DB_USER -d $DB_NAME -c "SELECT 'OK' AS status;"

echo
echo "════════════════════════════════════════════"
echo "  설치 완료! 아래 DATABASE_URL을 박으세요:"
echo "════════════════════════════════════════════"
echo
echo "DATABASE_URL=postgresql+asyncpg://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME"
echo
echo "다음 단계:"
echo "  1) /home/sinbc/general_school/.env 의 DATABASE_URL 위 값으로 변경"
echo "  2) /home/sinbc/general_school/start-backend.bat 의 DATABASE_URL 위 값으로 변경"
echo "  3) python -m scripts.migrate_sqlite_to_postgres  (기존 SQLite 데이터 이전)"
echo "  4) start-backend.bat 재시작"
echo
