@echo off
setlocal
cd /d "%~dp0"

if not exist "node.exe" (
  echo Missing node.exe. Copy the complete project folder.
  pause
  exit /b 1
)

if not exist "node_modules\ws\index.js" (
  echo Missing node_modules\ws. Copy the complete project folder.
  pause
  exit /b 1
)

node.exe server.js
if errorlevel 1 pause