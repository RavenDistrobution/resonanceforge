@echo off
REM ResonanceForge launcher (Windows). Checks Node, installs deps, handles port conflicts, starts the app.
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "APP_NAME=ResonanceForge"
REM Authorship signature (required; the app verifies it at start-up)
set "RF_SIGNATURE=VGhpcyBhcHAgd2FzIGRlc2lnbmVkIGFuZCBhdXRob3JlZCBieSBNQiBhbmQgaXMgb25seSBpbnRlbmRlZCB0byBiZSB1c2VkIGZvciBvcGVuc291cmNlIHJlc291cmNlcy4gQW55IHNhbGUgb2YgYSBkaXN0cmlidXRpb24gb2YgdGhpcyBzb2Z0d2FyZSBpcyBwcm9oaWJpdGVkIGFuZCBhbnkgYXR0ZW1wdCB0byBwYXRlbnQgb3Igb3RoZXJ3aXNlIG93biBwYXJ0cyBvZiB0aGlzIHNvZnR3YXJlIGFyZSBhbHNvLCBwcm9oaWJpdGVkLiAKCkRpc3RyaWJ1dGlvbjogClJhdmVuRGlzdHJvCgpLZXk6IAoxNzk2CgpJRDogCkl0J3MgZ290IGNvcm4gaW4gaXQ="
set "RF_KEY=1796"
if "%PORT%"=="" set "PORT=5180"

where node >nul 2>nul
if errorlevel 1 (
  echo [%APP_NAME%] Node.js is not installed. Download the LTS installer from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo [%APP_NAME%] Node.js 18 or newer is required.
  pause
  exit /b 1
)

if not exist node_modules\.package-lock.json (
  echo [%APP_NAME%] Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 ( echo [%APP_NAME%] npm install failed. & pause & exit /b 1 )
)

:checkport
set "PIDS="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo !PIDS! | findstr /c:"%%p" >nul || set "PIDS=!PIDS! %%p"
)
if "%PIDS%"=="" goto start

echo [%APP_NAME%] Port %PORT% is already in use by:
for %%p in (%PIDS%) do (
  for /f "tokens=1" %%n in ('tasklist /fi "PID eq %%p" /nh /fo csv') do echo    PID %%p  %%n
)
echo PIDs:%PIDS%
set "ans="
set /p ans="What now? [c] clear the port, [s] scan for the next free port, [q] quit: "
if /i "%ans%"=="c" (
  for %%p in (%PIDS%) do taskkill /pid %%p >nul 2>nul
  timeout /t 1 >nul
  for %%p in (%PIDS%) do taskkill /f /pid %%p >nul 2>nul
  timeout /t 1 >nul
  set "STILL="
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do set "STILL=%%p"
  if defined STILL ( echo [%APP_NAME%] Could not free port %PORT%. & pause & exit /b 1 )
  echo [%APP_NAME%] Port %PORT% is free.
  goto start
)
if /i "%ans%"=="s" (
  set /a PORT+=1
  goto checkport
)
echo [%APP_NAME%] Aborted.
exit /b 0

:start
echo [%APP_NAME%] Starting on http://127.0.0.1:%PORT%  (Ctrl+C to stop)
set PORT=%PORT%
call npx vite --host 127.0.0.1 --port %PORT% --strictPort --open
endlocal
