@echo off
chcp 65001 >nul
title General School - Backend (8002)
REM Project lives in WSL. Running uvicorn from Windows cmd via UNC path mounts
REM the working dir as a Z: drive but causes file-watcher and import edge cases.
REM Solution: invoke WSL bash so uvicorn runs natively under /home/...
REM (uses the venv at backend/venv where deps are installed)
wsl -d Ubuntu bash -c "cd /home/sinbc/general_school/backend && source venv/bin/activate && DATABASE_URL='sqlite+aiosqlite:///general_school.db' python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload"
pause
