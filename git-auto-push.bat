@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1
title CodexStudio Git Auto-Sync and Push Tool (v2.6.0)

echo ======================================================================
echo   Codex Studio - Cross-Folder Git History Sync ^& Auto-Push Tool
echo   Preserves 100%% of remote origin/main commit history automatically
echo ======================================================================
echo.

:: Step 1: Check Git CLI
where git >nul 2>&1
if errorlevel 1 (
    if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
    if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "PATH=%ProgramFiles(x86)%\Git\cmd;%PATH%"
    if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "PATH=%LocalAppData%\Programs\Git\cmd;%PATH%"
)
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH. Please install Git from https://git-scm.com/
    pause
    exit /b 1
)

:: Step 2: Resolve Target Folder
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "TARGET_DIR="
set "AUTO_YES=0"
if /i "%~1"=="-y" set "AUTO_YES=1"
if /i "%~2"=="-y" set "AUTO_YES=1"

if not "%~1"=="" if /i not "%~1"=="-y" (
    if exist "%~f1\server.js" if exist "%~f1\README.md" (
        set "TARGET_DIR=%~f1"
    )
)

if not defined TARGET_DIR (
    if exist "%SCRIPT_DIR%\server.js" if exist "%SCRIPT_DIR%\README.md" (
        set "TARGET_DIR=%SCRIPT_DIR%"
    )
)

if not defined TARGET_DIR (
    if exist "%CD%\server.js" if exist "%CD%\README.md" (
        set "TARGET_DIR=%CD%"
    )
)

if not defined TARGET_DIR (
    for /d %%D in ("%SCRIPT_DIR%\*") do (
        if exist "%%~fD\server.js" if exist "%%~fD\README.md" set "TARGET_DIR=%%~fD"
    )
)

if not defined TARGET_DIR (
    echo [ERROR] Could not locate CodexStudio project folder ^(containing server.js and README.md^).
    echo Please place this script inside the extracted version folder or drag the folder onto this script.
    pause
    exit /b 1
)

echo [1/5] Target Project Folder: "%TARGET_DIR%"
pushd "%TARGET_DIR%"

:: Step 3: Inherit or Configure Remote Repository URL
set "REPO_URL=https://github.com/DAMNDAGER/CodexStudio.git"
set "BRANCH=main"

if exist ".git" (
    for /f "delims=" %%U in ('git config --get remote.origin.url 2^>nul') do set "REPO_URL=%%U"
) else (
    for /d %%S in ("..\*") do (
        if exist "%%~fS\.git" (
            for /f "delims=" %%U in ('git -C "%%~fS" config --get remote.origin.url 2^>nul') do (
                if not "%%U"=="" set "REPO_URL=%%U"
            )
        )
    )
)

if "%AUTO_YES%"=="0" (
    echo.
    set /p "USER_REPO=Enter GitHub Remote URL [Press Enter for %REPO_URL%]: "
    if not "!USER_REPO!"=="" set "REPO_URL=!USER_REPO!"
)

if not exist ".git" (
    echo [2/5] Initializing local Git repository...
    git init >nul
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin "%REPO_URL%"
) else (
    git remote set-url origin "%REPO_URL%"
)

:: Ensure user.name and user.email are configured
for /f "delims=" %%N in ('git config --get user.name 2^>nul') do set "GIT_USER=%%N"
if not defined GIT_USER git config user.name "DAMNDAGER"
for /f "delims=" %%E in ('git config --get user.email 2^>nul') do set "GIT_EMAIL=%%E"
if not defined GIT_EMAIL git config user.email "DAMNDAGER@users.noreply.github.com"
git config core.autocrlf false

:: Step 4: Fetch Remote History & Graft onto origin/main
echo [3/5] Fetching remote commit history from origin/%BRANCH%...
git fetch origin %BRANCH%
git symbolic-ref HEAD refs/heads/%BRANCH%

git rev-parse --verify refs/remotes/origin/%BRANCH% >nul 2>&1
if not errorlevel 1 (
    echo       Grafting current folder onto latest origin/%BRANCH% history baseline...
    git reset --mixed refs/remotes/origin/%BRANCH% >nul
    git branch --set-upstream-to=origin/%BRANCH% %BRANCH% >nul 2>&1
    echo       Recent commit history preserved:
    git log refs/remotes/origin/%BRANCH% -n 3 --oneline
) else (
    echo       Remote branch origin/%BRANCH% not found yet; initializing fresh %BRANCH% branch.
)

:: Step 5: Stage Changes (Ignoring local runtime tokens & binaries) and Commit
echo [4/5] Staging project files...
git rm -r --cached --ignore-unmatch Image2Studio _internal .image2-token data/.image2-token >nul 2>&1

:: Sanitize data/config.json API keys if node is available
where node >nul 2>&1
if not errorlevel 1 (
    if exist "data\config.json" (
        node -e "const fs=require('fs');const p='data/config.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.onboarding_completed=false;(c.codexProviders||[]).forEach(x=>{x.api_key='';x.api_keys=[];});(c.imageProviders||[]).forEach(x=>{x.api_key='';x.api_keys=[];});fs.writeFileSync(p,JSON.stringify(c,null,2),'utf8');" 2>nul
    )
)

git add -A
git status --short

set "COMMIT_MSG=chore(release): update to v2.6.0"
if "%AUTO_YES%"=="0" (
    echo.
    set /p "USER_MSG=Enter commit message [Press Enter for '%COMMIT_MSG%']: "
    if not "!USER_MSG!"=="" set "COMMIT_MSG=!USER_MSG!"
)

git diff --cached --quiet
if not errorlevel 1 (
    echo       Working tree matches origin/%BRANCH%. No new commit needed.
) else (
    git commit -m "!COMMIT_MSG!"
)

:: Step 6: Push to origin/main
echo [5/5] Pushing to %REPO_URL% (%BRANCH%)...
git push -u origin %BRANCH%
if errorlevel 1 (
    echo [ERROR] Git push failed. Please check your network or GitHub credentials.
    popd
    if "%AUTO_YES%"=="0" pause
    exit /b 1
)

echo.
echo ======================================================================
echo   SUCCESS! Pushed to origin/%BRANCH% with full Git history preserved.
echo ======================================================================
git log -n 5 --oneline --decorate
popd
if "%AUTO_YES%"=="0" pause
exit /b 0
