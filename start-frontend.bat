@echo off
chcp 65001 >nul
title General School - Frontend (3000)
REM Project lives in WSL. Running 'npx next dev' from Windows cmd via UNC path
REM fails because Next.js cannot resolve the project root on \\wsl.localhost\...
REM Solution: invoke WSL bash so Next runs natively under /home/...
wsl -d Ubuntu bash -c "cd /home/sinbc/general_school/frontend && npx next dev --turbo -p 3000"
pause
