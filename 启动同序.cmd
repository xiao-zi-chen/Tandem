@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "release\0.3.1\win-unpacked\Tandem.exe" (
  start "" "%~dp0release\0.3.1\win-unpacked\Tandem.exe"
  exit /b
)
if exist "release\win-unpacked\Tandem.exe" (
  start "" "%~dp0release\win-unpacked\Tandem.exe"
  exit /b
)
node scripts/launch.mjs
if errorlevel 1 pause
