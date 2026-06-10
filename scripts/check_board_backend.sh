#!/bin/bash
# 보드 백엔드 검증 — alembic + import + board routes + hocuspocus tsc
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
echo "── alembic upgrade head ──"
alembic upgrade head 2>&1 | tail -2
echo "── app import + board routes ──"
python - <<'EOF'
from app.main import app
br = sorted({r.path for r in app.routes if "boards" in r.path})
print(f"total routes: {len(app.routes)}")
for p in br:
    print(" ", p)
assert br, "board routes missing!"
EOF
echo "── hocuspocus build (tsc) ──"
cd /home/sinbc/general_school/backend-hocuspocus
npm run build > /tmp/hocus-build.log 2>&1 && echo "hocuspocus build OK" || { tail -20 /tmp/hocus-build.log; exit 1; }
