@echo off
REM ResonanceForge launcher for Windows.
REM Clone the repo, double-click this file: it installs Node.js if needed, installs packages, handles the port, starts the app.
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "APP_NAME=ResonanceForge"
REM Authorship signature (required; the app verifies it at start-up)
set "RF_SIGNATURE=VGhpcyBhcHAgd2FzIGRlc2lnbmVkIGFuZCBhdXRob3JlZCBieSBNQiBhbmQgaXMgb25seSBpbnRlbmRlZCB0byBiZSB1c2VkIGZvciBvcGVuc291cmNlIHJlc291cmNlcy4gQW55IHNhbGUgb2YgYSBkaXN0cmlidXRpb24gb2YgdGhpcyBzb2Z0d2FyZSBpcyBwcm9oaWJpdGVkIGFuZCBhbnkgYXR0ZW1wdCB0byBwYXRlbnQgb3Igb3RoZXJ3aXNlIG93biBwYXJ0cyBvZiB0aGlzIHNvZnR3YXJlIGFyZSBhbHNvLCBwcm9oaWJpdGVkLiAKCkRpc3RyaWJ1dGlvbjogClJhdmVuRGlzdHJvCgpLZXk6IAoxNzk2CgpJRDogCkl0J3MgZ290IGNvcm4gaW4gaXQ="
set "RF_KEY=1796"
if "%PORT%"=="" set "PORT=5180"
title %APP_NAME%
echo.
echo  ==== %APP_NAME% ====
echo.

REM ---------------------------------------------------------------- Node.js
call :find_node
if "%NODE_OK%"=="1" goto node_ready

echo [%APP_NAME%] Node.js was not found. Installing Node.js LTS ^(one-time^)...
where winget >nul 2>nul
if not errorlevel 1 (
  echo [%APP_NAME%] Using winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements --silent
  call :find_node
  if "!NODE_OK!"=="1" goto node_ready
)
echo [%APP_NAME%] Downloading the Node.js LTS installer from nodejs.org...
set "NODE_MSI=%TEMP%\node-lts-x64.msi"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $idx=Invoke-RestMethod 'https://nodejs.org/dist/index.json'; $lts=($idx | Where-Object { $_.lts -ne $false } | Select-Object -First 1).version; $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }; $url=\"https://nodejs.org/dist/$lts/node-$lts-$arch.msi\"; Write-Host \"[ResonanceForge] $url\"; Invoke-WebRequest -Uri $url -OutFile '%NODE_MSI%'"
if errorlevel 1 (
  echo [%APP_NAME%] Download failed. Install Node.js LTS from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)
echo [%APP_NAME%] Running the installer ^(Windows will ask for permission^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process msiexec -ArgumentList '/i','\"%NODE_MSI%\"','/qn','/norestart' -Verb RunAs -Wait"
del "%NODE_MSI%" >nul 2>nul
call :find_node
if "%NODE_OK%"=="1" goto node_ready
echo [%APP_NAME%] Node.js still not found. Open a new window after installing, or install from https://nodejs.org, then run start.bat again.
pause
exit /b 1

:node_ready
for /f "delims=" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
echo [%APP_NAME%] Node.js v%NODE_MAJOR% found.
if %NODE_MAJOR% LSS 18 (
  echo [%APP_NAME%] Node.js 18 or newer is required. Install the LTS from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------- packages
set "NEED_INSTALL=0"
if not exist node_modules\.package-lock.json set "NEED_INSTALL=1"
if not exist node_modules\vite set "NEED_INSTALL=1"
if not exist node_modules\manifold-3d set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="1" (
  echo [%APP_NAME%] Installing packages ^(first run, a minute or two^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [%APP_NAME%] npm install failed. Check your internet connection and run start.bat again.
    pause
    exit /b 1
  )
) else (
  echo [%APP_NAME%] Packages already installed.
)

REM ---------------------------------------------------------------- port
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

REM ---------------------------------------------------------------- start
:start
echo [%APP_NAME%] Starting on http://127.0.0.1:%PORT%   ^(keep this window open; Ctrl+C stops it^)
set PORT=%PORT%
call npx vite --host 127.0.0.1 --port %PORT% --strictPort --open
if errorlevel 1 (
  echo [%APP_NAME%] The app stopped with an error. Read the message above, then press a key.
  pause
)
endlocal
exit /b 0

REM ---------------------------------------------------------------- helpers
:find_node
set "NODE_OK=0"
where node >nul 2>nul && set "NODE_OK=1"
if "%NODE_OK%"=="0" if exist "%ProgramFiles%\nodejs\node.exe" ( set "PATH=%ProgramFiles%\nodejs;%PATH%" & set "NODE_OK=1" )
if "%NODE_OK%"=="0" if exist "%ProgramFiles(x86)%\nodejs\node.exe" ( set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%" & set "NODE_OK=1" )
if "%NODE_OK%"=="0" if exist "%LocalAppData%\Programs\nodejs\node.exe" ( set "PATH=%LocalAppData%\Programs\nodejs;%PATH%" & set "NODE_OK=1" )
exit /b 0
