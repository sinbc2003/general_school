@echo off
chcp 65001 >nul
title General School - Frontend (3000)
REM pushd: UNC 경로(예: \\wsl.localhost\...)일 때 자동으로 임시 드라이브 문자 매핑.
pushd "%~dp0frontend"
npx next dev --turbo -p 3000
popd
pause
