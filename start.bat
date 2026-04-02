@echo off
title XI Launcher
cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Node.js is required but not installed.
    echo  Download it from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo  Installing dependencies — this may take a minute on first run...
    call npm install --silent
    if %errorlevel% neq 0 (
        echo.
        echo  Failed to install dependencies. Check your internet connection.
        pause
        exit /b 1
    )
)

:: Build the React app if needed
if not exist "build" (
    echo  Building UI — one moment...
    call npx react-scripts build --silent
    if %errorlevel% neq 0 (
        echo.
        echo  Build failed.
        pause
        exit /b 1
    )
)

:: Launch
echo  Starting XI Launcher...
start "" npx electron .
