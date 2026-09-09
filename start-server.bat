@echo off
title Dashboard Keuangan TikTok
echo ========================================
echo  DASHBOARD KEUANGAN TIKTOK
echo ========================================
echo.

:: Start Node server in background
echo [1/2] Starting server on port 9876...
start "Dashboard-Server" /MIN cmd /c "cd /d %~dp0 && node server.js"
timeout /t 4 /nobreak >nul

:: Quick tunnel — no admin needed, always works
echo [2/2] Starting public tunnel...
echo.
cloudflared tunnel --url http://localhost:9876 --no-autoupdate
pause
