@echo off
chcp 65001 >nul
title General School - Frontend (3000)
REM Use pushd instead of cd /d so UNC paths (e.g. \\wsl.localhost\...) auto-map to a drive letter.
pushd "%~dp0frontend"
npx next dev --turbo -p 3000
popd
pause
