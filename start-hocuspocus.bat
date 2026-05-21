@echo off
chcp 65001 >nul
title General School - Hocuspocus (1234)
REM Yjs CRDT 협업 서버 (문서/슬라이드/시트). backend(8002) 이미 떠있어야 함.
REM 안 띄우면 frontend에서 "연결 끊김" 표시.
wsl -d Ubuntu bash -c "cd /home/sinbc/general_school/backend-hocuspocus && npm run dev"
pause
