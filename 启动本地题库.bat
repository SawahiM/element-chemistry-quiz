@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if defined QUIZ_APP_PYTHON if exist "%QUIZ_APP_PYTHON%" (
  "%QUIZ_APP_PYTHON%" ".\tools\serve_local.py" %*
  goto finished
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 ".\tools\serve_local.py" %*
  goto finished
)

for /f "delims=" %%P in ('where python 2^>nul') do (
  "%%P" --version >nul 2>nul
  if not errorlevel 1 (
    "%%P" ".\tools\serve_local.py" %*
    goto finished
  )
)

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" ".\tools\serve_local.py" %*
  goto finished
)

if exist "A:\Greenwood\py313\python.exe" (
  "A:\Greenwood\py313\python.exe" ".\tools\serve_local.py" %*
  goto finished
)

echo 未找到 Python。请安装 Python 3，或通过 QUIZ_APP_PYTHON 指定 python.exe。

:finished
if errorlevel 1 echo 本地题库启动失败，请查看上方提示。
pause
