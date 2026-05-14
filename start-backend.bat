@echo off
chcp 65001 >nul
title General School - Backend (8002)
REM Project lives in WSL. Running uvicorn from Windows cmd via UNC path mounts
REM the working dir as a Z: drive but causes file-watcher and import edge cases.
REM Solution: invoke WSL bash so uvicorn runs natively under /home/...
REM (uses the venv at backend/venv where deps are installed)
REM DATABASE_URL 등 모든 설정은 ../.env에서 pydantic-settings가 자동 로드.
REM 비밀번호가 batch 파일에 노출되지 않음 (.env는 gitignored).
wsl -d Ubuntu bash -c "cd /home/sinbc/general_school/backend && source venv/bin/activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload"
pause
