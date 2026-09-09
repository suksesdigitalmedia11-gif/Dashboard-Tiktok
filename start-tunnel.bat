@echo off
title Dashboard Keuangan - Tunnel
echo Starting Cloudflare Tunnel for dashboard.datasdm.com...
echo.
cloudflared tunnel --url http://localhost:9876 --no-autoupdate
pause
