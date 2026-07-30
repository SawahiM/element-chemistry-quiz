@echo off
chcp 65001 >nul
cd /d "%~dp0"
"A:\Greenwood\py313\python.exe" ".\tools\serve_local.py"
pause
