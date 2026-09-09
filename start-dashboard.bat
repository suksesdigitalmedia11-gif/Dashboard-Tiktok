@echo off
REM ============================================
REM Dashboard Keuangan TikTok — Auto Start
REM ============================================
echo Starting Dashboard Keuangan TikTok...
echo.

REM 1. Start Node.js server
echo [1/2] Starting server on port 9876...
start "Dashboard-Server" /MIN cmd /c "cd /d C:\Users\Lenovo\Documents\dashboard-keuangan-tiktok && set PORT=9876 && node server.js"
echo       Server started (background)

REM 2. Start Cloudflare Tunnel
echo [2/2] Starting Cloudflare Tunnel...
start "Dashboard-Tunnel" /MIN cmd /c "cloudflared tunnel --config C:\Users\Lenovo\.cloudflared\dashboard-config.yml run"
echo       Tunnel started (background)

echo.
echo ============================================
echo Dashboard ready!
echo   Lokal:  http://localhost:9876
echo   Publik: https://keuangan.datasdm.com
echo ============================================
pause
