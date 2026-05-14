@echo off
chcp 65001 >nul
title General School - Backend (8002)
REM pushd: UNC 경로(예: \\wsl.localhost\...)일 때 자동으로 임시 드라이브 문자 매핑.
REM cd /d는 UNC 미지원이라 WSL 위 프로젝트에서 실패함.
pushd "%~dp0backend"
set DATABASE_URL=sqlite+aiosqlite:///general_school.db
python -m uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
popd
pause
