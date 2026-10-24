@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title CodexStudio Git Auto-Sync and Push Tool (Preserve History)
set "CS_SELF_PATH=%~f0"
set "CS_SCRIPT_DIR=%~dp0"
set "CS_ARG1=%~1"
set "CS_ARG2=%~2"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$lines = [System.IO.File]::ReadAllLines($env:CS_SELF_PATH, [System.Text.Encoding]::UTF8); $idx = [Array]::IndexOf($lines, '# === POWERSHELL_PAYLOAD_START ==='); if ($idx -lt 0) { Write-Error 'Payload marker not found'; exit 1 }; $script = [String]::Join([char]10, $lines[($idx + 1)..($lines.Length - 1)]); Invoke-Command -ScriptBlock ([scriptblock]::Create($script))"
set "CS_EXIT=%ERRORLEVEL%"
echo.
if not "%CS_ARG1%"=="-y" if not "%CS_ARG2%"=="-y" pause
exit /b %CS_EXIT%
# === POWERSHELL_PAYLOAD_START ===
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$DefaultRepoUrl = "https://github.com/DAMNDAGER/CodexStudio.git"
$DefaultBranch  = "main"

function Write-Header($text) {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
}

function Write-Step($step, $text) {
    Write-Host "`n[$step] $text" -ForegroundColor Yellow
}

function Write-Ok($text) {
    Write-Host "  [OK] $text" -ForegroundColor Green
}

function Write-Info($text) {
    Write-Host "  [i]  $text" -ForegroundColor Gray
}

function Write-WarnMsg($text) {
    Write-Host "  [!]  $text" -ForegroundColor Magenta
}

function Invoke-GitRaw {
    param(
        [string]$WorkDir,
        [string[]]$GitArgs,
        [switch]$AllowFail
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.WorkingDirectory = $WorkDir
    $escapedArgs = $GitArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }
    $psi.Arguments = ($escapedArgs -join " ")
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding  = [System.Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0 -and -not $AllowFail) {
        throw "Git command failed (exit $($proc.ExitCode)): git $($psi.Arguments)`n$stderr`n$stdout"
    }
    return [PSCustomObject]@{
        ExitCode = $proc.ExitCode
        StdOut   = ($stdout -replace "\r\n$", "" -replace "\n$", "")
        StdErr   = ($stderr -replace "\r\n$", "" -replace "\n$", "")
    }
}

Write-Header "Codex Studio · 跨版本文件夹 Git 无损历史同步推送工具"
Write-Host "  解决痛点：每次更换新版本文件夹无需手动建 main、100% 保留 GitHub 原有提交历史" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# Step 1: Check Git environment
# ---------------------------------------------------------------------------
Write-Step "1/6" "检查本机 Git 环境..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $candidatePaths = @(
        "$env:ProgramFiles\Git\cmd",
        "${env:ProgramFiles(x86)}\Git\cmd",
        "$env:LOCALAPPDATA\Programs\Git\cmd"
    )
    foreach ($cp in $candidatePaths) {
        if (Test-Path (Join-Path $cp "git.exe")) {
            $env:PATH = "$cp;$env:PATH"
            break
        }
    }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "  [ERROR] 未检测到 Git，请先安装 Git for Windows (https://git-scm.com/)" -ForegroundColor Red
    exit 1
}
$gitVer = (& git --version) -join ""
Write-Ok "已检测到 $gitVer"

# ---------------------------------------------------------------------------
# Step 2: Resolve target version folder (Inside folder / Drag-and-Drop / Parent auto-scan)
# ---------------------------------------------------------------------------
Write-Step "2/6" "定位待推送的 CodexStudio 版本文件夹..."

$arg1 = if ($env:CS_ARG1) { $env:CS_ARG1.Trim() } else { "" }
$arg2 = if ($env:CS_ARG2) { $env:CS_ARG2.Trim() } else { "" }
$autoConfirm = ($arg1 -eq "-y" -or $arg1 -eq "--yes" -or $arg2 -eq "-y" -or $arg2 -eq "--yes")
$customCommitMsg = ""

$scriptDir = $env:CS_SCRIPT_DIR.TrimEnd('\', '/')
$targetDir = $null

function Test-IsCodexStudioRoot($dirPath) {
    if (-not (Test-Path $dirPath -PathType Container)) { return $false }
    return ((Test-Path (Join-Path $dirPath "server.js")) -and (Test-Path (Join-Path $dirPath "README.md")))
}

if ($arg1 -and $arg1 -ne "-y" -and $arg1 -ne "--yes") {
    if (Test-Path $arg1 -PathType Leaf) {
        if ($arg1.ToLower().EndsWith(".zip")) {
            $extractDir = Join-Path (Split-Path $arg1 -Parent) ([System.IO.Path]::GetFileNameWithoutExtension($arg1))
            Write-Info "检测到拖入 ZIP 压缩包，正在解压至: $extractDir ..."
            Expand-Archive -LiteralPath $arg1 -DestinationPath $extractDir -Force
            $arg1 = $extractDir
        }
    }
    if (Test-Path $arg1 -PathType Container) {
        $resolvedArg = (Resolve-Path $arg1).Path
        if (Test-IsCodexStudioRoot $resolvedArg) {
            $targetDir = $resolvedArg
        } else {
            $subDirs = Get-ChildItem -LiteralPath $resolvedArg -Directory -ErrorAction SilentlyContinue
            foreach ($sd in $subDirs) {
                if (Test-IsCodexStudioRoot $sd.FullName) {
                    $targetDir = $sd.FullName
                    break
                }
            }
        }
    } else {
        $customCommitMsg = $arg1
    }
}

if (-not $targetDir) {
    $cwd = (Get-Location).Path
    if (Test-IsCodexStudioRoot $scriptDir) {
        $targetDir = $scriptDir
    } elseif (Test-IsCodexStudioRoot $cwd) {
        $targetDir = $cwd
    } else {
        # Parent directory scan: look for all CodexStudio* version folders
        $searchRoots = @($scriptDir, $cwd) | Select-Object -Unique
        $candidates = @()
        foreach ($sr in $searchRoots) {
            $dirs = Get-ChildItem -LiteralPath $sr -Directory -ErrorAction SilentlyContinue
            foreach ($d in $dirs) {
                if (Test-IsCodexStudioRoot $d.FullName) {
                    $candidates += $d
                } else {
                    $innerDirs = Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue
                    foreach ($id in $innerDirs) {
                        if (Test-IsCodexStudioRoot $id.FullName) {
                            $candidates += $id
                        }
                    }
                }
            }
        }
        $candidates = $candidates | Sort-Object -Property LastWriteTime -Descending | Select-Object -Unique
        if ($candidates.Count -eq 1) {
            $targetDir = $candidates[0].FullName
        } elseif ($candidates.Count -gt 1) {
            Write-Host "  在当前目录下发现多个版本文件夹：" -ForegroundColor Cyan
            for ($i = 0; $i -lt $candidates.Count; $i++) {
                $tag = if ($i -eq 0) { " [默认·最新]" } else { "" }
                Write-Host ("    [{0}] {1}{2}" -f ($i + 1), $candidates[$i].FullName, $tag) -ForegroundColor White
            }
            if ($autoConfirm) {
                $targetDir = $candidates[0].FullName
            } else {
                $choice = Read-Host "  请输入序号选择要推送的版本文件夹 (直接回车默认选 [1])"
                if ([string]::IsNullOrWhiteSpace($choice)) {
                    $targetDir = $candidates[0].FullName
                } elseif ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $candidates.Count) {
                    $targetDir = $candidates[[int]$choice - 1].FullName
                } else {
                    Write-Host "  [ERROR] 无效的选择序号。" -ForegroundColor Red
                    exit 1
                }
            }
        }
    }
}

if (-not $targetDir -or -not (Test-IsCodexStudioRoot $targetDir)) {
    Write-Host "  [ERROR] 未找到包含 server.js 和 README.md 的 CodexStudio 项目目录！" -ForegroundColor Red
    Write-Host "  提示：请将本脚本放在解压后的版本文件夹内双击，或直接把版本文件夹拖拽到本脚本图标上。" -ForegroundColor Yellow
    exit 1
}

# Extract detected version from server.js or README.md
$detectedVersion = "v2.6.0"
$serverJsPath = Join-Path $targetDir "server.js"
if (Test-Path $serverJsPath) {
    $sContent = [System.IO.File]::ReadAllText($serverJsPath, [System.Text.Encoding]::UTF8)
    if ($sContent -match "version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'") {
        $detectedVersion = "v" + $Matches[1]
    }
}
Write-Ok "目标目录: $targetDir"
Write-Ok "识别版本: $detectedVersion"

# ---------------------------------------------------------------------------
# Step 3: Discover or Inherit Git Repository Config from Current or Sibling Folders
# ---------------------------------------------------------------------------
Write-Step "3/6" "配置远程仓库与分支 (自动继承旧版本文件夹 Git 配置)..."

$repoUrl = $DefaultRepoUrl
$inheritedUser = $null
$inheritedEmail = $null

# Check current directory first
if (Test-Path (Join-Path $targetDir ".git")) {
    $curOrigin = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "--get", "remote.origin.url") -AllowFail
    if ($curOrigin.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($curOrigin.StdOut)) {
        $repoUrl = $curOrigin.StdOut.Trim()
    }
}

# Scan sibling directories in parent folder for previous .git config to inherit remote URL & author
$parentDir = Split-Path $targetDir -Parent
if ($parentDir -and (Test-Path $parentDir)) {
    $siblings = Get-ChildItem -LiteralPath $parentDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.FullName -ne $targetDir }
    foreach ($sib in $siblings) {
        $candGitDirs = @($sib.FullName)
        $subSibs = Get-ChildItem -LiteralPath $sib.FullName -Directory -ErrorAction SilentlyContinue
        foreach ($ss in $subSibs) { $candGitDirs += $ss.FullName }
        foreach ($cgd in $candGitDirs) {
            if (Test-Path (Join-Path $cgd ".git")) {
                $sibOrigin = Invoke-GitRaw -WorkDir $cgd -GitArgs @("config", "--get", "remote.origin.url") -AllowFail
                if ($sibOrigin.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($sibOrigin.StdOut)) {
                    if ($repoUrl -eq $DefaultRepoUrl) {
                        $repoUrl = $sibOrigin.StdOut.Trim()
                        Write-Info "已从旧版本文件夹 ($($sib.Name)) 自动继承远程地址: $repoUrl"
                    }
                }
                $sibName = Invoke-GitRaw -WorkDir $cgd -GitArgs @("config", "--get", "user.name") -AllowFail
                $sibMail = Invoke-GitRaw -WorkDir $cgd -GitArgs @("config", "--get", "user.email") -AllowFail
                if ($sibName.ExitCode -eq 0 -and $sibName.StdOut) { $inheritedUser = $sibName.StdOut.Trim() }
                if ($sibMail.ExitCode -eq 0 -and $sibMail.StdOut) { $inheritedEmail = $sibMail.StdOut.Trim() }
            }
        }
    }
}

if (-not $autoConfirm) {
    $inputRepo = Read-Host "  远程仓库地址 [直接回车使用 $repoUrl]"
    if (-not [string]::IsNullOrWhiteSpace($inputRepo)) {
        $repoUrl = $inputRepo.Trim()
    }
}

# Initialize .git if not present
if (-not (Test-Path (Join-Path $targetDir ".git"))) {
    Write-Info "当前为全新解压的版本文件夹，正在初始化本地 Git 仓库..."
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("init") | Out-Null
}

# Configure remote origin
$existingRemote = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "--get", "remote.origin.url") -AllowFail
if ($existingRemote.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingRemote.StdOut)) {
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("remote", "set-url", "origin", $repoUrl) | Out-Null
} else {
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("remote", "add", "origin", $repoUrl) | Out-Null
}

# Ensure git user.name and user.email exist so commit never fails
$chkName = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "--get", "user.name") -AllowFail
if ($chkName.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($chkName.StdOut)) {
    $uName = if ($inheritedUser) { $inheritedUser } else { "DAMNDAGER" }
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "user.name", $uName) | Out-Null
    Write-Info "已自动配置 Git 提交用户名: $uName"
}
$chkMail = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "--get", "user.email") -AllowFail
if ($chkMail.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($chkMail.StdOut)) {
    $uMail = if ($inheritedEmail) { $inheritedEmail } else { "DAMNDAGER@users.noreply.github.com" }
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "user.email", $uMail) | Out-Null
    Write-Info "已自动配置 Git 提交邮箱: $uMail"
}

# Avoid CRLF warnings blocking smooth execution on Windows
Invoke-GitRaw -WorkDir $targetDir -GitArgs @("config", "core.autocrlf", "false") -AllowFail | Out-Null

Write-Ok "已绑定远程仓库: $repoUrl (目标分支: $DefaultBranch)"

# ---------------------------------------------------------------------------
# Step 4: Fetch remote history & Graft current folder onto origin/main
# ---------------------------------------------------------------------------
Write-Step "4/6" "拉取 GitHub 远端历史并无损嫁接至当前版本文件夹..."

Write-Info "正在执行 git fetch origin $DefaultBranch ..."
$fetchRes = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("fetch", "origin", $DefaultBranch) -AllowFail

# Force HEAD symbolic reference to refs/heads/main (no manual git branch -M main needed!)
Invoke-GitRaw -WorkDir $targetDir -GitArgs @("symbolic-ref", "HEAD", "refs/heads/$DefaultBranch") | Out-Null

$remoteRefCheck = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("rev-parse", "--verify", "refs/remotes/origin/$DefaultBranch") -AllowFail
if ($remoteRefCheck.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($remoteRefCheck.StdOut)) {
    $remoteSha = $remoteRefCheck.StdOut.Trim()
    Write-Ok "成功获取远端 origin/$DefaultBranch 最新历史基线 (Commit: $($remoteSha.Substring(0, 7)))"

    # Check if local HEAD already exists and is a descendant of origin/main
    $headCheck = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("rev-parse", "--verify", "HEAD") -AllowFail
    $isDescendant = $false
    if ($headCheck.ExitCode -eq 0) {
        $ancCheck = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("merge-base", "--is-ancestor", "refs/remotes/origin/$DefaultBranch", "HEAD") -AllowFail
        if ($ancCheck.ExitCode -eq 0) {
            $isDescendant = $true
        }
    }
    if (-not $isDescendant) {
        # Soft/Mixed graft: move branch pointer & index to origin/main WITHOUT touching working tree files!
        Invoke-GitRaw -WorkDir $targetDir -GitArgs @("reset", "--mixed", "refs/remotes/origin/$DefaultBranch") | Out-Null
        Write-Ok "已将当前新版本文件夹无缝挂载至 origin/$DefaultBranch 历史顶端（工作区新文件 100% 保留）"
    } else {
        Write-Ok "当前分支已包含 origin/$DefaultBranch 完整历史链，继续增量提交"
    }
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("branch", "--set-upstream-to=origin/$DefaultBranch", $DefaultBranch) -AllowFail | Out-Null

    Write-Info "已保留并衔接的远端最近提交记录 (git log -n 3):"
    $recentLogs = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("log", "refs/remotes/origin/$DefaultBranch", "-n", "3", "--oneline") -AllowFail
    if ($recentLogs.StdOut) {
        foreach ($line in ($recentLogs.StdOut -split "`r?`n")) {
            Write-Host "      * $line" -ForegroundColor DarkCyan
        }
    }
} else {
    Write-WarnMsg "远端仓库尚无 $DefaultBranch 分支或无法访问远端分支，将以当前文件夹作为初始 main 分支推送。"
}

# ---------------------------------------------------------------------------
# Step 5: Privacy & Binary Guardrails (.gitignore + data/config.json API key scrub)
# ---------------------------------------------------------------------------
Write-Step "5/6" "执行安全巡检 (过滤二进制大文件 + 自动脱敏本地 API Key)..."

$gitignorePath = Join-Path $targetDir ".gitignore"
if (Test-Path $gitignorePath) {
    $giContent = [System.IO.File]::ReadAllText($gitignorePath, [System.Text.Encoding]::UTF8)
    $needAppend = @()
    foreach ($rule in @(".image2-token", "data/.image2-token", "Image2Studio/", "_internal/")) {
        if ($giContent -notmatch [regex]::Escape($rule)) {
            $needAppend += $rule
        }
    }
    if ($needAppend.Count -gt 0) {
        $giContent = $giContent.TrimEnd() + "`n" + ($needAppend -join "`n") + "`n"
        [System.IO.File]::WriteAllText($gitignorePath, $giContent, (New-Object System.Text.UTF8Encoding($false)))
    }
}

# Ensure binary directories or local tokens are never tracked in git index
Invoke-GitRaw -WorkDir $targetDir -GitArgs @("rm", "-r", "--cached", "--ignore-unmatch", "Image2Studio", "_internal", ".image2-token", "data/.image2-token") -AllowFail | Out-Null

# Temporarily sanitize data/config.json if user tested locally and saved real API keys
$configJsonPath = Join-Path $targetDir "data\config.json"
$configBackupBytes = $null
try {
    if (Test-Path $configJsonPath) {
        $rawConfigText = [System.IO.File]::ReadAllText($configJsonPath, [System.Text.Encoding]::UTF8)
        # Check if any non-empty api_key exists
        if ($rawConfigText -match '"api_key"\s*:\s*"[^"]+"') {
            $configBackupBytes = [System.IO.File]::ReadAllBytes($configJsonPath)
            $sanitizedText = $rawConfigText -replace '("api_key"\s*:\s*)"[^"]*"', '$1""'
            $sanitizedText = $sanitizedText -replace '("api_keys"\s*:\s*)\[[^\]]*\]', '$1[]'
            $sanitizedText = $sanitizedText -replace '("onboarding_completed"\s*:\s*)true', '$1false'
            [System.IO.File]::WriteAllText($configJsonPath, $sanitizedText, (New-Object System.Text.UTF8Encoding($false)))
            Write-Ok "检测到本地 data/config.json 含有测试 API Key，已自动在 Git 暂存区脱敏（提交后将自动恢复本地原文件）"
        }
    }

    # Stage all changes
    Invoke-GitRaw -WorkDir $targetDir -GitArgs @("add", "-A") | Out-Null

    $statusRes = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("status", "--short")
    if ([string]::IsNullOrWhiteSpace($statusRes.StdOut)) {
        Write-Ok "当前文件夹内容与远端 origin/$DefaultBranch 完全一致，无需产生新 Commit。"
    } else {
        $changedLines = $statusRes.StdOut -split "`r?`n" | Where-Object { $_ -ne "" }
        Write-Ok "相较于上一版本共检测到 $($changedLines.Count) 个文件变更："
        $previewCount = [Math]::Min($changedLines.Count, 15)
        for ($i = 0; $i -lt $previewCount; $i++) {
            Write-Host "      $($changedLines[$i])" -ForegroundColor Gray
        }
        if ($changedLines.Count -gt 15) {
            Write-Host "      ... 以及另外 $($changedLines.Count - 15) 个文件" -ForegroundColor DarkGray
        }

        $defaultMsg = "chore(release): update to $detectedVersion"
        if ([string]::IsNullOrWhiteSpace($customCommitMsg)) {
            if ($autoConfirm) {
                $commitMsg = $defaultMsg
            } else {
                $userMsg = Read-Host "`n  请输入 Commit 提交说明 [直接回车默认: $defaultMsg]"
                $commitMsg = if ([string]::IsNullOrWhiteSpace($userMsg)) { $defaultMsg } else { $userMsg.Trim() }
            }
        } else {
            $commitMsg = $customCommitMsg
        }

        $commitRes = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("commit", "-m", $commitMsg)
        Write-Ok "已完成本地提交: $commitMsg"
    }
} finally {
    if ($null -ne $configBackupBytes -and (Test-Path $configJsonPath)) {
        [System.IO.File]::WriteAllBytes($configJsonPath, $configBackupBytes)
        Write-Info "已恢复本机 data/config.json 的本地 API Key 配置。"
    }
}

# ---------------------------------------------------------------------------
# Step 6: Push to origin/main (and optional Git Tag)
# ---------------------------------------------------------------------------
Write-Step "6/6" "推送新版本提交至 GitHub (origin/$DefaultBranch)..."

$pushRes = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("push", "-u", "origin", $DefaultBranch) -AllowFail
if ($pushRes.ExitCode -ne 0) {
    Write-Host "  [ERROR] 推送失败！详细输出如下：" -ForegroundColor Red
    Write-Host $pushRes.StdErr -ForegroundColor Red
    Write-Host $pushRes.StdOut -ForegroundColor Red
    exit 1
}

Write-Ok "成功推送至 $repoUrl ($DefaultBranch 分支)，原有 Git 提交历史已 100% 完整保留！"

if (-not $autoConfirm) {
    $wantTag = Read-Host "`n  是否同时创建并推送版本标签 Tag [$detectedVersion]？(输入 y 回车推送 Tag，直接回车跳过)"
    if ($wantTag -match '^[yY]') {
        Invoke-GitRaw -WorkDir $targetDir -GitArgs @("tag", "-f", $detectedVersion, "-m", "Release $detectedVersion") | Out-Null
        $tagPush = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("push", "-f", "origin", $detectedVersion) -AllowFail
        if ($tagPush.ExitCode -eq 0) {
            Write-Ok "已成功推送版本标签 Tag: $detectedVersion"
        } else {
            Write-WarnMsg "推送 Tag 失败: $($tagPush.StdErr)"
        }
    }
}

Write-Header "全部完成！最新提交历史预览 (git log -n 5)"
$finalLog = Invoke-GitRaw -WorkDir $targetDir -GitArgs @("log", "-n", "5", "--oneline", "--decorate") -AllowFail
if ($finalLog.StdOut) {
    foreach ($l in ($finalLog.StdOut -split "`r?`n")) {
        Write-Host "  $l" -ForegroundColor Green
    }
}
