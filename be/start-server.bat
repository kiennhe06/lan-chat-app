@echo off
REM LANChat Server - chay CO cua so console (de xem loi / debug).
REM Uu tien Node portable trong thu muc node\, neu khong co thi dung Node cai san tren may.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title LANChat Server

set "NODE_EXE=%~dp0node\node.exe"
if exist "%NODE_EXE%" goto run

where node >nul 2>nul
if errorlevel 1 (
  echo [LANChat] Khong tim thay Node.js: can thu muc node\ ^(ban portable^) hoac Node cai san tren may.
  pause
  exit /b 1
)
set "NODE_EXE=node"

:run
"%NODE_EXE%" "%~dp0index.js" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [LANChat] Server da dung voi ma loi %EXIT_CODE%. Xem log tai data\logs\server\
  pause
)
endlocal & exit /b %EXIT_CODE%
