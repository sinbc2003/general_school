@echo off
chcp 65001 >nul
title General School - Backend (8002)
REM Use pushd instead of cd /d so UNC paths (e.g. \\wsl.localhost\...) auto-map to a drive letter.
pushd "%~dp0backend"
set DATABASE_URL=sqlite+aiosqlite:///general_school.db
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
popd
pause
