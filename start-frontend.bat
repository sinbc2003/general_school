@echo off
chcp 65001 >nul
title General School - Frontend (3000)
cd /d "%~dp0frontend"
npx next dev --turbo -p 3000
pause
