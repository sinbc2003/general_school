#!/bin/bash
# 화이트보드 백엔드 검증 — import + routes + hocuspocus tsc
set -e
cd /home/sinbc/general_school/backend
source venv/bin/activate
python - <<'EOF'
from app.main import app
wb = sorted({r.path for r in app.routes if "whiteboards" in r.path})
print(f"total routes: {len(app.routes)}")
for p in wb:
    print(" ", p)
assert wb, "whiteboard routes missing!"
EOF
cd /home/sinbc/general_school/backend-hocuspocus
npm run build > /tmp/hocus-build.log 2>&1 && echo "hocuspocus build OK" || { tail -20 /tmp/hocus-build.log; exit 1; }
