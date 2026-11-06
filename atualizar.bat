@echo off
title Atualizando Lebes Automation...
color 0B
echo ===================================================
echo   PREPARANDO A ATUALIZACAO DO SISTEMA
echo   Fechando a versao atual...
echo ===================================================
echo.

:: 1. Mata o processo do aplicativo em execucao (cobre as duas variacoes de nome)
taskkill /F /IM "LebesAutomation.exe" /T >nul 2>&1
taskkill /F /IM "lebes-automation.exe" /T >nul 2>&1

:: Aguarda 2 segundos para o Windows liberar os arquivos da memoria
timeout /t 2 /nobreak >nul

:: 2. Aponta direto para a sua nova pasta de atualizacoes na rede
cd /d "S:\TI\INFORMAÇÕES DE USO INTERNO\SERVICE DESK\Diversos\Automacao\LebesAutomation\Atualizacoes"

:: 3. Procura automaticamente o instalador (.exe) e executa
echo Iniciando o instalador da nova versao...
for %%f in (*.exe) do (
    start "" "%%f"
    exit
)