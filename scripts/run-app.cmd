@echo off
rem HuduiGroup watchdog: restart node 5s after crash
cd /d C:\perry
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    set "NODE_EXE=%%i"
    goto :found
  )
)
:found
echo [%date% %time%] watchdog start node=%NODE_EXE% >> C:\perry\data\boot.log
:loop
"%NODE_EXE%" server\index.js >> C:\perry\data\service.log 2>&1
echo [%date% %time%] node exited, restart in 5s >> C:\perry\data\boot.log
timeout /t 5 /nobreak >nul
goto loop
