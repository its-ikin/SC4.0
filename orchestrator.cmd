@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%orchestrator.ps1"

if not "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
  exit /b %ERRORLEVEL%
)

cd /d "%SCRIPT_DIR%"
title TwinOps Orchestrator

:menu
cls
echo TwinOps Orchestrator
echo ====================
echo.
echo 1. Start app
echo 2. Stop app
echo 3. Restart app
echo 4. Status
echo 5. Logs
echo 0. Exit
echo.

choice /C 123450 /N /M "Choose an option: "
set "MENU_CHOICE=%ERRORLEVEL%"
if "%MENU_CHOICE%"=="6" exit /b 0
if "%MENU_CHOICE%"=="5" call :run logs
if "%MENU_CHOICE%"=="4" call :run status
if "%MENU_CHOICE%"=="3" call :run restart
if "%MENU_CHOICE%"=="2" call :run stop
if "%MENU_CHOICE%"=="1" call :run start
goto menu

:run
cls
echo Running: %~1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %~1
set "LAST_EXIT=%ERRORLEVEL%"
echo.
if /I "%~1"=="start" echo App URL: http://localhost:5173
if not "%LAST_EXIT%"=="0" echo Command failed with exit code %LAST_EXIT%.
echo.
pause
exit /b %LAST_EXIT%
