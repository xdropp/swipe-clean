@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Swipe Clean - diagnostico

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias pela primeira vez, aguarde...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Abrindo o Swipe Clean e iniciando a analise automaticamente...
echo O log fica em %%APPDATA%%\Swipe Clean\log.txt
call npm start -- --auto-scan
