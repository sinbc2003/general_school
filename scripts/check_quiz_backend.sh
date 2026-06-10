#!/bin/bash
# 라이브 퀴즈 백엔드 검증 — alembic + import + quiz routes (dev)
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
pg_isready -h localhost -p 5432 || sudo service postgresql start
echo "── alembic upgrade head ──"
alembic upgrade head 2>&1 | tail -3
echo "── app import + quiz routes ──"
python - <<'EOF'
from app.main import app
quiz = sorted({r.path for r in app.routes if "quiz" in r.path})
print(f"total routes: {len(app.routes)}")
for p in quiz:
    print(" ", p)
assert quiz, "quiz routes missing!"
EOF
