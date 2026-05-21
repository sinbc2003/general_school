@echo off
chcp 65001 >nul
title General School - Frontend (3000)
REM Project lives in WSL. Running 'npx next dev' from Windows cmd via UNC path
REM fails because Next.js cannot resolve the project root on \\wsl.localhost\...
REM Solution: invoke WSL bash so Next runs natively under /home/...
REM
REM NOTE: --turbo 옵션 제거됨. turbo 모드는 빠르지만 hot reload 시 종종
REM SSR/CSR bundle의 React reference가 어긋나 "Cannot read properties of
REM null (reading 'useContext')" 같은 캐시 corruption 발생. webpack 모드는
REM 빌드 약간 느리지만(2~3초) 훨씬 안정적. production 가기 전 dev 환경도
REM 안정 유지 우선.
wsl -d Ubuntu bash -c "cd /home/sinbc/general_school/frontend && npx next dev -p 3000"
pause
