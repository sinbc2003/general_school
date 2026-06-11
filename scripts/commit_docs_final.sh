#!/bin/bash
set -e
cd /home/sinbc/general_school
git add HANDOFF_NEXT_SESSION.md scripts/commit_docs_final.sh
git commit -m "docs: HANDOFF 갱신 — 업무 및 수업 도구 세션 마감 (공유·드라이브 통합까지 완료)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
git log --oneline -3
