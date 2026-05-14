@echo off
chcp 65001 >nul
title General School - DEMO Tunnel
setlocal

REM ============================================
REM  General School 외부 시연용 임시 URL 생성 스크립트
REM ============================================
REM  학교 방문 시 다른 선생님들에게 웹페이지 보여주는 용도.
REM  Cloudflare Tunnel (Quick Tunnel) — 가입 없이 임시 trycloudflare.com 도메인 받음.
REM
REM  사전 준비:
REM    1. cloudflared.exe 설치 — winget install Cloudflare.cloudflared
REM    2. backend가 BACKEND_PORT에서 떠 있어야 함 (기본 8002)
REM    3. 이 스크립트가 frontend(3000)를 데모 모드로 새로 띄움 — 평소 띄워둔 frontend는 종료할 것
REM ============================================

REM 사용자가 backend 포트 수정 필요 시 여기만 바꾸면 됨
set BACKEND_PORT=8002

set BACKEND_PROXY_URL=http://localhost:%BACKEND_PORT%

echo.
echo ========================================
echo  General School Demo Tunnel
echo ========================================
echo  Backend  : http://localhost:%BACKEND_PORT%  (별도 창에서 띄워둘 것)
echo  Frontend : http://localhost:3000           (이 스크립트가 새 창에 띄움)
echo  Tunnel   : Cloudflare Quick Tunnel
echo ========================================
echo.

REM cloudflared 존재 확인
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [ERROR] cloudflared가 설치되지 않았습니다.
  echo   winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

REM backend 응답 확인
echo [1/3] backend(%BACKEND_PORT%) 헬스체크...
curl -sS --max-time 3 http://localhost:%BACKEND_PORT%/api/health >nul 2>nul
if errorlevel 1 (
  echo   [WARN] backend가 응답하지 않습니다. start-backend.bat 먼저 실행하세요.
  echo   ^(또는 BACKEND_PORT 변수를 수정^)
  echo.
  set /p CONTINUE="그래도 계속 진행? (y/N) "
  if /i not "%CONTINUE%"=="y" exit /b 1
) else (
  echo   OK
)

REM frontend를 데모 모드로 새 창에 띄움
echo [2/3] frontend를 데모 모드로 시작...
echo   NEXT_PUBLIC_API_URL="" (same-origin)
echo   BACKEND_PROXY_URL=%BACKEND_PROXY_URL%
REM pushd: UNC 경로(예: \\wsl.localhost\...)도 자동 매핑됨. cd /d는 UNC 미지원이라 WSL 프로젝트에서 실패.
start "General School - Frontend (Demo)" cmd /k "pushd %~dp0frontend && set NEXT_PUBLIC_API_URL= && set BACKEND_PROXY_URL=%BACKEND_PROXY_URL% && npx next dev --turbo -p 3000"

REM frontend 부팅 대기
echo   frontend 부팅 대기 (8초)...
timeout /t 8 /nobreak >nul

REM cloudflared 시작 — 이 창에서 그대로 출력 유지
echo [3/3] Cloudflare Tunnel 시작...
echo   ===========================================================
echo   ★ 아래 출력 중 https://xxxx-yyyy.trycloudflare.com 형식의
echo     URL을 복사해서 선생님들께 공유하세요.
echo   ★ 이 창을 닫으면 터널이 끊깁니다.
echo   ★ Ctrl+C로 종료.
echo   ===========================================================
echo.

cloudflared tunnel --url http://localhost:3000

echo.
echo 터널이 종료되었습니다.
pause
