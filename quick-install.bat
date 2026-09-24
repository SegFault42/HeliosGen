@echo off
REM Script de instalação rápida para yt-dlp Hotkey
REM Executa como Administrador para melhor compatibilidade

setlocal enabledelayedexpansion

echo.
echo ============================================
echo   yt-dlp Hotkey Setup - Windows
echo ============================================
echo.

REM Verificar se Python está instalado
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python não encontrado!
    echo Instale Python de: https://www.python.org/downloads/
    echo Certifique-se de marcar "Add Python to PATH"
    pause
    exit /b 1
)

echo ✅ Python detectado
python --version

REM Instalar dependências
echo.
echo 📦 Instalando dependências Python...
pip install yt-dlp pyperclip

if errorlevel 1 (
    echo ❌ Erro ao instalar dependências
    pause
    exit /b 1
)

echo ✅ Dependências instaladas com sucesso!

REM Criar diretório de trabalho
set "APPDIR=%LOCALAPPDATA%\yt-dlp"
if not exist "%APPDIR%" (
    mkdir "%APPDIR%"
    echo ✅ Diretório criado: %APPDIR%
)

REM Copiar arquivos
echo.
echo 📋 Copiando arquivos...
copy "yt-dlp-downloader.py" "%APPDIR%\" >nul
copy "yt-dlp-hotkey.ahk" "%APPDIR%\" >nul

echo ✅ Arquivos copiados para: %APPDIR%

REM Informações finais
echo.
echo ============================================
echo   PRÓXIMOS PASSOS
echo ============================================
echo.
echo 1. Baixe AutoHotkey v2.0+:
echo    https://www.autohotkey.com/download/
echo.
echo 2. Abra: %APPDIR%\yt-dlp-hotkey.ahk
echo.
echo 3. Cole um link e pressione: Ctrl+Alt+D
echo.
echo Videos serão salvos em:
echo C:\Users\%USERNAME%\Downloads\yt-dlp\
echo.
echo ============================================
echo.
pause
