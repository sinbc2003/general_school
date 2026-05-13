@echo off
chcp 65001 >nul
title General School - Backend (8002)
cd /d "%~dp0backend"
set DATABASE_URL=sqlite+aiosqlite:///general_school.db
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
pause
