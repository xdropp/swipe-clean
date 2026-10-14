@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Swipe Clean - gerar instalador

where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 goto erro
)

echo Gerando instalador e versao portatil (pode levar alguns minutos)...
call npm run dist
if errorlevel 1 goto erro

echo.
echo Pronto! Os arquivos estao na pasta dist:
dir /b dist\*.exe
echo.
explorer dist
pause
exit /b 0

:erro
echo.
echo Algo deu errado ao gerar o instalador. Veja as mensagens acima.
pause
exit /b 1
