@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem 本地调试管理员。可在启动脚本前设置同名环境变量覆盖默认值。
if not defined CHEMQUIZ_ADMIN_USERNAME set "CHEMQUIZ_ADMIN_USERNAME=chemquiz_admin"
if not defined CHEMQUIZ_ADMIN_PASSWORD set "CHEMQUIZ_ADMIN_PASSWORD=ChemQuiz-Local-Admin-2026!"
if not defined DATABASE_URL set "DATABASE_URL=postgresql://quizapp:quizapp-local-2026@127.0.0.1:5432/quizapp"
if not defined CHEMQUIZ_TRUST_PROXY set "CHEMQUIZ_TRUST_PROXY=1"

echo 本地管理员账号：%CHEMQUIZ_ADMIN_USERNAME%
echo 本地管理员密码：%CHEMQUIZ_ADMIN_PASSWORD%
echo 本地数据库：PostgreSQL 127.0.0.1:5432/quizapp
echo 管理后台地址：http://127.0.0.1:3000/chemquiz-control
echo.

if defined QUIZ_APP_PYTHON if exist "%QUIZ_APP_PYTHON%" (
  "%QUIZ_APP_PYTHON%" ".\tools\serve_local.py" --host 127.0.0.1 %*
  goto finished
)

where py >nul 2>nul
if not errorlevel 1 (
  py -3 ".\tools\serve_local.py" --host 127.0.0.1 %*
  goto finished
)

for /f "delims=" %%P in ('where python 2^>nul') do (
  "%%P" --version >nul 2>nul
  if not errorlevel 1 (
    "%%P" ".\tools\serve_local.py" --host 127.0.0.1 %*
    goto finished
  )
)

if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" ".\tools\serve_local.py" --host 127.0.0.1 %*
  goto finished
)

if exist "A:\Greenwood\py313\python.exe" (
  "A:\Greenwood\py313\python.exe" ".\tools\serve_local.py" --host 127.0.0.1 %*
  goto finished
)

echo 未找到 Python。请安装 Python 3，或通过 QUIZ_APP_PYTHON 指定 python.exe。

:finished
if errorlevel 1 echo 本地题库启动失败，请查看上方提示。
pause
