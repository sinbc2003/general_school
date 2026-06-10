#!/bin/bash
# 단어장 백엔드 검증 — alembic + import + wordbook routes (dev)
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
echo "── alembic upgrade head ──"
alembic upgrade head 2>&1 | tail -2
echo "── app import + wordbook routes ──"
python - <<'EOF'
from app.main import app
wb = sorted({r.path for r in app.routes if "wordbook" in r.path})
print(f"total routes: {len(app.routes)}")
for p in wb:
    print(" ", p)
assert wb, "wordbook routes missing!"
EOF
