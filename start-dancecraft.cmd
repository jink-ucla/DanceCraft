@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment is missing. Run scripts\setup-windows.ps1 first.
  exit /b 1
)
rem yt-dlp lives in the venv; ffmpeg comes from WinGet links.
set "PYTHON_PATH=%CD%\.venv\Scripts\python.exe"
set "PATH=%CD%\.venv\Scripts;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\WinGet\Links;%PATH%"
call npm.cmd run dev
