#!/bin/bash
# 실시간 투표 백엔드 검증 — alembic + import + poll routes (dev)
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
pg_isready -h localhost -p 5432 || sudo service postgresql start
echo "── alembic upgrade head ──"
alembic upgrade head 2>&1 | tail -3
echo "── app import + poll routes ──"
python - <<'EOF'
from app.main import app
poll = sorted({r.path for r in app.routes if "/tools/poll" in r.path})
print(f"total routes: {len(app.routes)}")
for p in poll:
    print(" ", p)
assert poll, "poll routes missing!"
EOF
