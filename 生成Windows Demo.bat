@echo off
chcp 65001 >nul
title 生成元素化学题库 Windows Demo
cd /d "%~dp0"
echo 正在生成最新版 Windows Demo，请稍候……
echo.
"A:\Greenwood\py313\python.exe" ".\tools\build_windows_demo.py"
if errorlevel 1 (
  echo.
  echo 打包失败，请保留本窗口中的错误信息。
) else (
  echo.
  echo 打包完成：release\ElementChemistryDemo-Windows-x64.zip
)
echo.
pause
