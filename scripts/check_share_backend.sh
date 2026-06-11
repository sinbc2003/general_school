#!/bin/bash
# 공유/사본 백엔드 검증 — alembic + import + 신규 routes (dev)
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
echo "── alembic upgrade head ──"
alembic upgrade head 2>&1 | tail -2
echo "── app import + share/duplicate routes ──"
python - <<'EOF'
from app.main import app
rs = sorted({r.path for r in app.routes if "share" in r.path or "duplicate" in r.path})
print(f"total routes: {len(app.routes)}")
for p in rs:
    print(" ", p)
assert any("wordbook" in p for p in rs), "wordbook share routes missing"
assert any("boards" in p for p in rs), "board share routes missing"
EOF
