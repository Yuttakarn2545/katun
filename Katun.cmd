@echo off
chcp 65001 >nul
title Katun Studio
cd /d "%~dp0"
node bin\katun.js app %*
if errorlevel 1 (
  echo.
  echo เปิดโปรแกรมไม่สำเร็จ ลองรัน install.cmd อีกครั้ง
  pause
)
