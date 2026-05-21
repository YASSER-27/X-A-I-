@echo off
title Downloading Llama.cpp Release...
echo ===================================================
echo [!] Starting download for llama.cpp binary
echo ===================================================

:: تحميل الملف المضغوط باستخدام curl المدمج في ويندوز
echo Downloading ZIP file...
curl -L -O "https://github.com/ggml-org/llama.cpp/releases/download/b9267/llama-b9267-bin-win-cpu-x64.zip"

echo ===================================================
echo [+] Download completed successfully!
echo ===================================================
pause