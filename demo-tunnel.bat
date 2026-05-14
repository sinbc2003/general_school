@echo off
chcp 65001 >nul
title General School - DEMO Tunnel
setlocal

REM ============================================
REM  General School demo: temporary public URL via Cloudflare Quick Tunnel.
REM  For school visit demo (showing the site to other teachers).
REM
REM  Prereqs:
REM    1. cloudflared installed -- winget install Cloudflare.cloudflared
REM    2. backend running on BACKEND_PORT (default 8002)
REM    3. This script will open a NEW frontend(3000) window in demo mode.
REM       Close any frontend you already had running first.
REM ============================================

REM Edit this if your backend uses a different port.
set BACKEND_PORT=8002

set BACKEND_PROXY_URL=http://localhost:%BACKEND_PORT%

echo.
echo ========================================
echo  General School Demo Tunnel
echo ========================================
echo  Backend  : http://localhost:%BACKEND_PORT%  (run separately)
echo  Frontend : http://localhost:3000           (this script opens it)
echo  Tunnel   : Cloudflare Quick Tunnel
echo ========================================
echo.

REM cloudflared check
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cloudflared is not installed.
  echo   winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

REM backend health check
echo [1/3] backend(%BACKEND_PORT%) health check...
curl -sS --max-time 3 http://localhost:%BACKEND_PORT%/api/health >nul 2>nul
if errorlevel 1 (
  echo   [WARN] backend not responding. Run start-backend.bat first.
  echo   ^(or edit BACKEND_PORT in this file^)
  echo.
  set /p CONTINUE="Continue anyway? (y/N) "
  if /i not "%CONTINUE%"=="y" exit /b 1
) else (
  echo   OK
)

REM Start frontend in demo mode (same-origin via Next rewrites)
echo [2/3] starting frontend in demo mode...
echo   NEXT_PUBLIC_API_URL="" (same-origin)
echo   BACKEND_PROXY_URL=%BACKEND_PROXY_URL%
REM pushd auto-maps UNC paths (e.g. \\wsl.localhost\...) -- cd /d would fail there.
start "General School - Frontend (Demo)" cmd /k "pushd %~dp0frontend && set NEXT_PUBLIC_API_URL= && set BACKEND_PROXY_URL=%BACKEND_PROXY_URL% && npx next dev --turbo -p 3000"

REM Wait for frontend to boot
echo   waiting for frontend to boot (8s)...
timeout /t 8 /nobreak >nul

REM Start cloudflared in this window
echo [3/3] starting Cloudflare Tunnel...
echo   ===========================================================
echo   * Copy the https://xxxx-yyyy.trycloudflare.com URL shown
echo     below and share it with the other teachers.
echo   * Closing this window kills the tunnel.
echo   * Press Ctrl+C to stop.
echo   ===========================================================
echo.

cloudflared tunnel --url http://localhost:3000

echo.
echo Tunnel stopped.
pause
